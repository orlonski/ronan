import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { PATH_METADATA } from "@nestjs/common/constants";
import { ehCapacidadeApp } from "@ronan/shared-types";
import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator";
import { declaracaoDoHandler, ehRotaDoApp } from "../../auth/guards/capacidade-app.guard";
import { ENDPOINTS_M_SEM_CAPACIDADE } from "./endpoints-m-sem-capacidade";

/**
 * No boot, cobra que todo handler de `/m/*` diga o que exige do acesso ao app:
 * `@RequerCapacidade(...)`, `@CapacidadeLivre("motivo")` ou `@Public()`.
 *
 * Irmão do `ModulosBootCheck`, e duro pelo mesmo motivo: handler novo sem
 * declaração é tela nova do app que nenhuma empresa consegue desligar, e aviso
 * no log ninguém cobra. Derruba a subida, portanto o CI.
 *
 * Também derruba:
 * - capacidade que não existe no catálogo (erro de digitação vira porta aberta);
 * - linha da dívida conhecida que venceu o prazo.
 */
@Injectable()
export class CapacidadesBootCheck implements OnModuleInit {
  private readonly log = new Logger(CapacidadesBootCheck.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const erros = verificarCapacidades(this.discovery, this.scanner, this.reflector);
    if (erros.problemas.length) throw new Error(`\n\n${erros.problemas.join("\n\n")}\n`);
    this.log.log(`${erros.verificados} endpoints do app verificados — todos declaram o que exigem`);
  }
}

export function verificarCapacidades(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
  hoje = new Date(),
): { verificados: number; problemas: string[] } {
  const faltando: string[] = [];
  const invalidas: string[] = [];
  let verificados = 0;

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    if (!ehRotaDoApp(reflector.get<string>(PATH_METADATA, metatype) ?? "")) continue;

    const proto = Object.getPrototypeOf(instance);
    for (const metodo of scanner.getAllMethodNames(proto)) {
      const handler = proto[metodo];
      if (typeof handler !== "function" || !Reflect.hasMetadata(PATH_METADATA, handler)) continue;
      verificados++;
      const alvos = [handler, metatype];
      const nome = `${metatype.name}.${metodo}`;
      if (reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, alvos)) continue;
      const decl = declaracaoDoHandler(reflector, handler, metatype);
      if (decl.tipo === "livre") continue;
      if (decl.tipo === "nada") {
        if (!ENDPOINTS_M_SEM_CAPACIDADE.has(nome)) faltando.push(nome);
        continue;
      }
      const chaves = typeof decl.exige === "string" ? [decl.exige] : decl.exige.algum;
      for (const c of chaves) if (!ehCapacidadeApp(c)) invalidas.push(`${nome} → ${c}`);
    }
  }

  const vencidas = [...ENDPOINTS_M_SEM_CAPACIDADE.entries()]
    .filter(([, d]) => new Date(`${d.ate}T23:59:59-03:00`).getTime() < hoje.getTime())
    .map(([nome, d]) => `${nome} (dono: ${d.dono}, venceu ${d.ate})`);

  const problemas: string[] = [];
  if (faltando.length) {
    problemas.push(
      `Endpoints do app (/m/*) que não dizem o que exigem do acesso:\n  - ${faltando.join("\n  - ")}\n\n` +
        `Anote com @RequerCapacidade("app.x"), @RequerCapacidade({ algum: [...] }) ou ` +
        `@CapacidadeLivre("por que qualquer um com o app pode chamar").`,
    );
  }
  if (invalidas.length) {
    problemas.push(`Capacidades que não existem no catálogo:\n  - ${invalidas.join("\n  - ")}`);
  }
  if (vencidas.length) {
    problemas.push(
      `Dívida do acesso ao app com prazo vencido (endpoints-m-sem-capacidade.ts):\n  - ${vencidas.join("\n  - ")}`,
    );
  }
  return { verificados, problemas };
}
