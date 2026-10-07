import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESCOPO_POR_CHAVE, moduloDaChave, type EscopoIntegracao } from "@ronan/shared-types";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { PERMISSAO_KEY } from "../auth/decorators/requer-permissao.decorator";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { IntegracaoGuard } from "./integracao.guard";
import { CONTRATO_KEY, type ContratoRota } from "./rota-v1";
import { DOCUMENTACAO_PUBLICA } from "./documentacao.controller";
import { openApiCanonico } from "./openapi";

/** O contrato publicado, commitado. Mudou a API? Atualize com `ATUALIZAR_OPENAPI=1 pnpm exec vitest run src/publica/openapi.spec.ts`. */
export const ARQUIVO_CONTRATO = join(__dirname, "..", "..", "openapi", "v1.json");

/**
 * Derruba a subida se a `/v1` sair do trilho. Sem lista de exceções: a API
 * pública nasce limpa e assim fica.
 *
 *  - todo controller `v1` tem o `IntegracaoGuard` na classe e é `@Public()`
 *    (o porteiro é o guard, não o JWT) — e nenhum usa `@Roles`/`@RequerPermissao`,
 *    que são do painel e dariam a falsa impressão de proteger;
 *  - todo handler `v1` declara `@RotaV1` (sem contrato = sem validação e sem
 *    documentação), com escopo do catálogo e preso a um módulo;
 *  - nenhum controller FORA da `v1` usa o `IntegracaoGuard` (a chave de
 *    integração não entra no painel nem no app);
 *  - o contrato gerado é igual ao commitado em `openapi/v1.json`. Não há CI e
 *    o Dockerfile não roda teste: sem isto, mudar o formato de uma resposta
 *    iria pro ar calado e quebraria o sistema do cliente.
 */
@Injectable()
export class PublicaBootCheck implements OnModuleInit {
  private readonly log = new Logger(PublicaBootCheck.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const problemas = verificarControllers(this.discovery, this.scanner, this.reflector);
    const contrato = verificarContratoCommitado();
    if (contrato) problemas.push(contrato);
    if (problemas.length > 0) {
      throw new Error(`\n\nAPI pública (/v1) fora do trilho:\n  - ${problemas.join("\n  - ")}\n`);
    }
    this.log.log("API pública (/v1): rotas com contrato e porteiro; contrato igual ao publicado");
  }
}

export function verificarControllers(discovery: DiscoveryService, scanner: MetadataScanner, reflector: Reflector): string[] {
  const problemas: string[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    // eslint-disable-next-line @typescript-eslint/ban-types
    const classe = metatype as unknown as Function;
    const rota = (reflector.get<string>(PATH_METADATA, classe) ?? "").replace(/^\//, "");
    const ehV1 = rota === "v1" || rota.startsWith("v1/");
    const guardasClasse = reflector.get<unknown[] | undefined>(GUARDS_METADATA, classe) ?? [];
    const proto = Object.getPrototypeOf(instance);
    const handlers = scanner
      .getAllMethodNames(proto)
      .map((m) => ({ nome: m, fn: proto[m] }))
      .filter((h) => typeof h.fn === "function" && Reflect.hasMetadata(PATH_METADATA, h.fn));

    if (!ehV1) {
      const usa = guardasClasse.includes(IntegracaoGuard) ||
        handlers.some((h) => (reflector.get<unknown[] | undefined>(GUARDS_METADATA, h.fn) ?? []).includes(IntegracaoGuard));
      if (usa) problemas.push(`${classe.name}: usa IntegracaoGuard fora da /v1 — a chave de integração não entra no painel nem no app.`);
      continue;
    }
    if (reflector.get<boolean>(DOCUMENTACAO_PUBLICA, classe)) continue;

    if (!guardasClasse.includes(IntegracaoGuard)) problemas.push(`${classe.name}: controller da /v1 sem IntegracaoGuard na classe (use @ControllerV1()).`);
    if (!reflector.get<boolean>(IS_PUBLIC_KEY, classe)) problemas.push(`${classe.name}: controller da /v1 sem @Public() — o JWT do painel barraria a chave.`);
    for (const h of handlers) {
      const nome = `${classe.name}.${h.nome}`;
      if (reflector.getAllAndOverride(ROLES_KEY, [h.fn, classe])) problemas.push(`${nome}: @Roles não vale na /v1 (é do painel).`);
      if (reflector.getAllAndOverride(PERMISSAO_KEY, [h.fn, classe])) problemas.push(`${nome}: @RequerPermissao não vale na /v1; o escopo vai no @RotaV1.`);
      const contrato = reflector.get<ContratoRota | undefined>(CONTRATO_KEY, h.fn);
      if (!contrato) {
        problemas.push(`${nome}: rota da /v1 sem @RotaV1 (sem contrato não há validação nem documentação).`);
        continue;
      }
      if (contrato.escopo !== null) {
        const def = ESCOPO_POR_CHAVE[contrato.escopo as EscopoIntegracao];
        if (!def) problemas.push(`${nome}: escopo "${contrato.escopo}" fora do catálogo (shared-types/src/integracoes.ts).`);
        else for (const p of def.permissoes) if (!moduloDaChave(p)) problemas.push(`${nome}: a chave ${p} do escopo não pertence a módulo nenhum.`);
      }
    }
  }
  return problemas;
}

export function verificarContratoCommitado(): string | null {
  let commitado: string;
  try {
    commitado = readFileSync(ARQUIVO_CONTRATO, "utf8");
  } catch {
    return `não achei ${ARQUIVO_CONTRATO}. Gere com ATUALIZAR_OPENAPI=1 pnpm exec vitest run src/publica/openapi.spec.ts e commite.`;
  }
  if (commitado !== openApiCanonico()) {
    return (
      "o contrato gerado mudou e openapi/v1.json não. Se a mudança é de propósito: " +
      "ATUALIZAR_OPENAPI=1 pnpm exec vitest run src/publica/openapi.spec.ts, anote em docs/api-publica/CHANGELOG.md e commite os dois. " +
      "Se não é: alguma rota mudou o que entra ou sai sem querer — e isso quebraria o sistema do cliente."
    );
  }
  return null;
}
