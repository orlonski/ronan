import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PATH_METADATA } from "@nestjs/common/constants";
import { CAPACIDADES_APP, type CapacidadeApp } from "@ronan/shared-types";
import {
  CAPACIDADE_KEY,
  CAPACIDADE_LIVRE_KEY,
  type ExigenciaCapacidade,
} from "../../common/acesso-app/capacidade.decorator";
import { CachePorConta } from "../../common/conta/cache-por-conta";
import { ymdSaoPaulo } from "../../common/timezone";
import { PrismaService } from "../../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { AuthUser } from "../types";
import { ACESSO_KEY, type AcessoFlag } from "./acesso-motorista.guard";

/** A coluna antiga → a capacidade que ela espelha (pra quem ainda usa `@AcessoMotorista`). */
const CAPACIDADE_DA_COLUNA = new Map<string, CapacidadeApp>(
  CAPACIDADES_APP.filter((c) => c.colunaLegada?.espelha).map((c) => [c.colunaLegada!.coluna, c.chave]),
);

export type DeclaracaoCapacidade =
  | { tipo: "exige"; exige: ExigenciaCapacidade }
  | { tipo: "livre"; motivo: string }
  | { tipo: "nada" };

/**
 * O que o handler declara. O MÉTODO vence a CLASSE, nos dois sentidos: classe
 * livre com um método que exige, ou classe que exige com um método livre. Em
 * cada nível, o decorator novo vem antes do `@AcessoMotorista` antigo (que é
 * lido pela coluna que a capacidade espelha).
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function declaracaoDoHandler(reflector: Reflector, handler: Function, classe: Function): DeclaracaoCapacidade {
  for (const alvo of [handler, classe]) {
    const exige = reflector.get<ExigenciaCapacidade | undefined>(CAPACIDADE_KEY, alvo);
    if (exige) return { tipo: "exige", exige };
    const motivo = reflector.get<string | undefined>(CAPACIDADE_LIVRE_KEY, alvo);
    if (motivo) return { tipo: "livre", motivo };
    const flag = reflector.get<AcessoFlag | undefined>(ACESSO_KEY, alvo);
    const daColuna = flag ? CAPACIDADE_DA_COLUNA.get(flag) : undefined;
    if (daColuna) return { tipo: "exige", exige: daColuna };
  }
  return { tipo: "nada" };
}

export function ehRotaDoApp(caminhoDoController: string): boolean {
  return caminhoDoController === "m" || caminhoDoController.startsWith("m/");
}

/**
 * O SERVIDOR COBRA O ACESSO CALCULADO no `/m/*` (F4).
 *
 * ⚠️ EM SOMBRA ATÉ A PLATAFORMA TRAVAR. Por decisão do dono, nenhuma empresa
 * perde funcionalidade por efeito automático. Então, pra cada requisição que
 * este guard barraria, ele grava `CAPACIDADE_SOMBRA` (quem, o quê, onde) e deixa
 * passar. Só barra a capacidade que está em `capacidadesTravadas` daquela
 * empresa, e isso a plataforma liga uma a uma, vendo antes a lista.
 *
 * Regras:
 * - Só olha MOTORISTA e FUNCIONÁRIO. Admin e identidade pura seguem com os
 *   guards de sempre (`@Roles` de cada controller).
 * - Sem linha calculada pra pessoa (cadastro de minutos atrás) → passa. "Não
 *   sei" nunca vira "não pode".
 * - `{ algum: [...] }` só barra se TODAS as opções estiverem travadas: travar
 *   uma não pode fechar a porta que outra ainda abre.
 * - Recusa é 403 com `code: CAPACIDADE_DESLIGADA`, nunca 500. Um 500 trava a
 *   fila de envio do app em loop; o 403 manda o item pra conferência do
 *   escritório (a vala dos lançamentos travados), com o conteúdo inteiro.
 */
@Injectable()
export class CapacidadeAppGuard implements CanActivate {
  private readonly log = new Logger(CapacidadeAppGuard.name);
  private readonly travadas = new CachePorConta<ReadonlySet<string>>("capacidades-travadas", 15_000);
  /** Uma linha de sombra por pessoa, rota e dia basta pro relatório. */
  private readonly sombraVista = new Set<string>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const controller = context.getClass();
    if (!ehRotaDoApp(this.reflector.get<string>(PATH_METADATA, controller) ?? "")) return true;
    const alvos = [context.getHandler(), controller];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, alvos)) return true;
    const decl = declaracaoDoHandler(this.reflector, context.getHandler(), controller);
    // Livre, ou dívida conhecida (o boot-check não deixa nascer outra).
    if (decl.tipo !== "exige") return true;
    const exige = decl.exige;

    const req = context.switchToHttp().getRequest<{ user?: AuthUser; method: string; route?: { path?: string } }>();
    const user = req.user;
    if (!user || (user.kind !== "MOTORISTA" && user.kind !== "FUNCIONARIO")) return true;

    const opcoes = typeof exige === "string" ? [exige] : exige.algum;
    const cpf = user.cpf.replace(/\D/g, "");
    const efetivo = await this.prisma.acessoEfetivoApp.findUnique({
      where: { contaId_cpf: { contaId: user.contaId, cpf } },
      select: { capacidades: true },
    });
    if (!efetivo) return true;
    if (opcoes.some((c) => efetivo.capacidades.includes(c))) return true;

    const travadas = await this.travadas.obter(
      async (contaId) =>
        new Set(
          (
            await this.prisma.configuracaoAcessoApp.findUnique({
              where: { contaId },
              select: { capacidadesTravadas: true },
            })
          )?.capacidadesTravadas ?? [],
        ),
      new Set<string>(),
    );
    const rota = `${req.method} ${req.route?.path ?? ""}`;
    if (opcoes.every((c) => travadas.has(c))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "CAPACIDADE_DESLIGADA",
        capacidade: opcoes[0],
        message: "Isso não está no seu app nesta empresa. Se você precisa, fale com o escritório.",
      });
    }
    this.registrarSombra(user.contaId, cpf, opcoes, rota);
    return true;
  }

  private registrarSombra(contaId: string, cpf: string, opcoes: CapacidadeApp[], rota: string): void {
    const chave = `${contaId}|${cpf}|${rota}|${ymdSaoPaulo(new Date())}`;
    if (this.sombraVista.has(chave)) return;
    if (this.sombraVista.size > 50_000) this.sombraVista.clear();
    this.sombraVista.add(chave);
    // Fire-and-forget: o relatório nunca atrasa nem derruba a requisição.
    void this.prisma.logAcessoApp
      .create({ data: { contaId, tipo: "CAPACIDADE_SOMBRA", cpf, perdeu: opcoes, causa: rota } })
      .catch((e: unknown) =>
        this.log.warn(`sombra não gravada (${rota}): ${e instanceof Error ? e.message : e}`),
      );
  }
}
