import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { comoSistema } from "../../common/conta/conta-context";
import { comLockDeCron } from "../../common/cron-exclusivo";
import { definirGravador, gravarAgora, type RegistroChamada } from "../../common/chamadas-externas/interceptor";

/** Conteúdo (pedido/resposta) some em 30 dias; o resumo fica 12 meses. */
const DIAS_CONTEUDO = 30;
const DIAS_RESUMO = 365;

export type FiltroChamadas = {
  servico?: string;
  contaId?: string;
  soErros?: boolean;
  busca?: string;
  de?: string;
  ate?: string;
  pagina?: number;
};

const json = (v: unknown) => (v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

/**
 * Grava o que o interceptador capturou (em lote, a cada 3 s, fora do caminho da
 * requisição) e serve a tela "Chamadas externas" da plataforma.
 */
@Injectable()
export class ChamadasExternasService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ChamadasExternasService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    definirGravador(async (lote: RegistroChamada[]) => {
      try {
        await comoSistema(() =>
          this.prisma.chamadaExterna.createMany({
            data: lote.map((r) => ({ ...r, pedido: json(r.pedido), resposta: json(r.resposta) })),
          }),
        );
      } catch (e) {
        // Registro é best-effort: perder uma linha é barato, derrubar a API não.
        this.log.warn(`Não gravou ${lote.length} chamada(s) externa(s): ${(e as Error).message}`);
      }
    });
    this.timer = setInterval(() => void gravarAgora().catch(() => {}), 3000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await gravarAgora().catch(() => {});
  }

  /** Toda madrugada: apaga o conteúdo com mais de 30 dias e o resumo com mais de 12 meses. */
  @Cron("0 40 3 * * *", { name: "limpar-chamadas-externas", timeZone: "America/Sao_Paulo" })
  async limpar(): Promise<void> {
    await comLockDeCron(this.prisma, "limpar-chamadas-externas", async () => {
      await comoSistema(async () => {
        const dia = 86_400_000;
        await this.prisma.chamadaExterna.updateMany({
          where: { criadoEm: { lt: new Date(Date.now() - DIAS_CONTEUDO * dia) }, OR: [{ pedido: { not: Prisma.AnyNull } }, { resposta: { not: Prisma.AnyNull } }] },
          data: { pedido: Prisma.DbNull, resposta: Prisma.DbNull },
        });
        await this.prisma.chamadaExterna.deleteMany({ where: { criadoEm: { lt: new Date(Date.now() - DIAS_RESUMO * dia) } } });
      });
    });
  }

  private where(f: FiltroChamadas): Prisma.ChamadaExternaWhereInput {
    return {
      ...(f.servico ? { servico: f.servico } : {}),
      ...(f.contaId ? { contaId: f.contaId } : {}),
      ...(f.soErros ? { ok: false } : {}),
      ...(f.de || f.ate
        ? { criadoEm: { ...(f.de ? { gte: new Date(f.de) } : {}), ...(f.ate ? { lte: new Date(f.ate) } : {}) } }
        : {}),
      ...(f.busca
        ? {
            OR: [
              { caminho: { contains: f.busca, mode: "insensitive" } },
              { gatilho: { contains: f.busca, mode: "insensitive" } },
              { erro: { contains: f.busca, mode: "insensitive" } },
            ],
          }
        : {}),
    };
  }

  async listar(f: FiltroChamadas) {
    const tamanho = 50;
    const pagina = Math.max(1, f.pagina ?? 1);
    const where = this.where(f);
    const [itens, total] = await Promise.all([
      this.prisma.chamadaExterna.findMany({
        where,
        orderBy: { criadoEm: "desc" },
        skip: (pagina - 1) * tamanho,
        take: tamanho,
        omit: { pedido: true, resposta: true },
      }),
      this.prisma.chamadaExterna.count({ where }),
    ]);
    return { itens: await this.comNomeDaConta(itens), total, pagina, tamanho };
  }

  /** Por serviço no período: chamadas, erros, tempo médio e tokens de IA. */
  async resumo(f: FiltroChamadas) {
    const where = this.where({ ...f, servico: undefined, soErros: undefined });
    const [todos, erros, servicos] = await Promise.all([
      this.prisma.chamadaExterna.groupBy({
        by: ["servico"],
        where,
        _count: { _all: true },
        _avg: { duracaoMs: true },
        _sum: { iaTokensEntrada: true, iaTokensSaida: true },
      }),
      this.prisma.chamadaExterna.groupBy({ by: ["servico"], where: { ...where, ok: false }, _count: { _all: true } }),
      this.prisma.chamadaExterna.findMany({ distinct: ["servico"], select: { servico: true } }),
    ]);
    const errosDe = new Map(erros.map((e) => [e.servico, e._count._all]));
    return {
      porServico: todos
        .map((t) => ({
          servico: t.servico,
          chamadas: t._count._all,
          erros: errosDe.get(t.servico) ?? 0,
          duracaoMediaMs: Math.round(t._avg.duracaoMs ?? 0),
          tokensEntrada: t._sum.iaTokensEntrada ?? 0,
          tokensSaida: t._sum.iaTokensSaida ?? 0,
        }))
        .sort((a, b) => b.chamadas - a.chamadas),
      servicos: servicos.map((s) => s.servico).sort(),
    };
  }

  async detalhe(id: string) {
    const c = await this.prisma.chamadaExterna.findUnique({ where: { id } });
    if (!c) throw new NotFoundException("Chamada não encontrada (pode ter sido apagada pela limpeza).");
    return (await this.comNomeDaConta([c]))[0]!;
  }

  private async comNomeDaConta<T extends { contaId: string | null }>(itens: T[]) {
    const ids = [...new Set(itens.map((i) => i.contaId).filter((x): x is string => !!x))];
    const contas = ids.length
      ? await comoSistema(() => this.prisma.conta.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } }))
      : [];
    const nome = new Map(contas.map((c) => [c.id, c.nome]));
    return itens.map((i) => ({ ...i, conta: i.contaId ? (nome.get(i.contaId) ?? null) : null }));
  }
}
