import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { moduloDaChave } from "@ronan/shared-types";
import { PERMISSAO_KEY } from "../../auth/decorators/requer-permissao.decorator";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { PlataformaGuard } from "../../auth/guards/plataforma.guard";
import { chaveDoHandler, ENDPOINTS_SEM_PERMISSAO } from "./endpoints-sem-permissao";

/**
 * No boot, varre os controllers e cobra que todo endpoint de `admin/*` declare
 * permissão.
 *
 * Por que no boot e não num guard: um guard só descobre o handler desprotegido
 * quando alguém o chama — e aí já é tarde, já respondeu. O boot-check descobre
 * antes de subir, o que significa que descobre no CI, que significa que quem
 * escreveu o endpoint recebe o aviso enquanto ainda lembra do que estava
 * fazendo.
 *
 * Endpoint novo sem decorator DERRUBA O BOOT. É duro de propósito: a alternativa
 * (avisar no log) é o mesmo "etapa 1 de 2" que ficou em produção por meses no
 * webhook do WhatsApp. Aviso que não quebra nada não é cobrado por ninguém.
 *
 * Os que já existiam vivem em `ENDPOINTS_SEM_PERMISSAO`, e essa lista só encolhe.
 */
@Injectable()
export class ModulosBootCheck implements OnModuleInit {
  private readonly log = new Logger(ModulosBootCheck.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const faltando: string[] = [];
    const semModulo: string[] = [];
    let verificados = 0;

    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;

      const rota = this.reflector.get<string>(PATH_METADATA, metatype) ?? "";
      // Só `admin/*`: as rotas do motorista têm outro modelo (flags por
      // motorista) e as públicas se defendem por segredo próprio.
      if (!rota.startsWith("admin/")) continue;

      // Controller inteiro atrás do PlataformaGuard já está fechado, e fechado
      // MAIS do que a matriz fecharia: só a casa entra. Cobrar permissão além
      // disso seria pedir que a plataforma conceda a si mesma acesso ao que só
      // ela pode ver.
      if (temPlataformaGuard(this.reflector, metatype as unknown as Function)) continue;

      const proto = Object.getPrototypeOf(instance);
      for (const metodo of this.scanner.getAllMethodNames(proto)) {
        const handler = proto[metodo];
        if (typeof handler !== "function") continue;

        // Só o que é endpoint HTTP de verdade.
        const temRota = Reflect.hasMetadata(PATH_METADATA, handler);
        if (!temRota) continue;
        verificados++;

        const publico = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
          handler,
          metatype,
        ]);
        if (publico) continue;
        if (temPlataformaGuard(this.reflector, handler as Function)) continue;

        const chaves = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSAO_KEY, [
          handler,
          metatype,
        ]);
        const nome = chaveDoHandler(metatype.name, metodo);

        if (!chaves || chaves.length === 0) {
          if (!ENDPOINTS_SEM_PERMISSAO.has(nome)) faltando.push(nome);
          continue;
        }

        // Permissão declarada mas fora de qualquer módulo: o ModuloGuard não
        // saberia o que cobrar, e a tela ficaria sem contrato nenhum.
        for (const c of chaves) {
          if (!moduloDaChave(c)) semModulo.push(`${nome} → ${c}`);
        }
      }
    }

    if (faltando.length > 0 || semModulo.length > 0) {
      const partes: string[] = [];
      if (faltando.length > 0) {
        partes.push(
          `Endpoints de admin/* sem @RequerPermissao (o PermissaoGuard é fail-open, ` +
            `então eles estão abertos pra qualquer ADMIN_USER):\n  - ` +
            faltando.join("\n  - ") +
            `\n\nAnote com @RequerPermissao("recurso.acao"). Se for mesmo pra qualquer ` +
            `admin, declare em common/modulos/endpoints-sem-permissao.ts com o motivo.`,
        );
      }
      if (semModulo.length > 0) {
        partes.push(
          `Chaves de permissão que não pertencem a módulo nenhum:\n  - ` +
            semModulo.join("\n  - ") +
            `\n\nDiga em qual módulo o recurso entra, em shared-types/src/modulos.ts.`,
        );
      }
      throw new Error(`\n\n${partes.join("\n\n")}\n`);
    }

    this.log.log(
      `${verificados} endpoints de admin verificados — todos com permissão e módulo declarados`,
    );
  }
}

/** O alvo (classe ou handler) declara `PlataformaGuard` em `@UseGuards`? */
// eslint-disable-next-line @typescript-eslint/ban-types
function temPlataformaGuard(reflector: Reflector, alvo: Function): boolean {
  const guards = reflector.get<unknown[] | undefined>(GUARDS_METADATA, alvo);
  return Array.isArray(guards) && guards.includes(PlataformaGuard);
}
