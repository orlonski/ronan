import { Injectable, NotFoundException } from "@nestjs/common";
import { StatusExecucaoAgente, type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { paginate, type PaginationQuery } from "../../common/pagination";
import { SEM_ESCOPO } from "../../common/escopo/escopo";
import { FilaExecucoesService } from "../../clickup-runner/fila.service";

export type ListDemandasParams = PaginationQuery & { status?: string };

/** Payload que a FonteDemanda `payload` sabe ler (titulo/descricao). */
type PayloadDemanda = {
  titulo: string;
  descricao: string;
  origem: "painel";
  criadoPorId?: string;
  criadoPorNome?: string;
};

/**
 * Demandas criadas pelo painel — o mesmo caminho do webhook, sem depender de
 * ferramenta externa (a Automation do ClickUp é recurso pago).
 *
 * Escreve na MESMA fila (`execucoes_agente`) e no formato que a fonte `payload`
 * já consome, então o agente não muda nada pra atender por aqui.
 */
@Injectable()
export class DemandasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: FilaExecucoesService,
  ) {}

  /** Id curto e legível pra virar branch (`feat/d-3f9a21`). */
  private novoTaskId(): string {
    return `d-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  }

  async criar(entrada: {
    titulo: string;
    descricao: string;
    usuario: { id: string; nome: string };
  }) {
    const payload: PayloadDemanda = {
      titulo: entrada.titulo.trim(),
      descricao: entrada.descricao.trim(),
      origem: "painel",
      criadoPorId: entrada.usuario.id,
      criadoPorNome: entrada.usuario.nome,
    };

    // Id novo a cada demanda: nunca colide com execução ativa, e cada uma ganha
    // a própria branch/PR mesmo repetindo o mesmo pedido.
    const r = await this.fila.enfileirar({ taskId: this.novoTaskId(), payload });
    if (!r.aceito) {
      // Só acontece se o id sorteado colidir — refaz uma vez.
      const retry = await this.fila.enfileirar({ taskId: this.novoTaskId(), payload });
      if (!retry.aceito) throw new Error("Não consegui enfileirar a demanda");
      return this.formatar(retry.job);
    }
    return this.formatar(r.job);
  }

  async list(params: ListDemandasParams) {
    const where: Prisma.ExecucaoAgenteWhereInput = {};
    if (params.status && params.status in StatusExecucaoAgente) {
      where.status = params.status as StatusExecucaoAgente;
    }

    const pagina = await paginate<Record<string, unknown>, ListDemandasParams>(
      this.prisma.execucaoAgente,
      {
        params,
        where: where as Record<string, unknown>,
      // Model sem coluna de frota: não há o que filtrar por transportadora. O
      // isolamento entre EMPRESAS aqui é da trava de conta; o recorte por frota
      // fica com a matriz de papéis (não existe guard de escopo — ver escopo.ts).
      escopo: SEM_ESCOPO,
        sortable: { criadoEm: "criadoEm", status: "status", duracaoMs: "duracaoMs" },
        defaultSort: { field: "criadoEm", order: "desc" },
      },
    );
    return { ...pagina, data: pagina.data.map((j) => this.formatar(j as never)) };
  }

  async findOne(id: string) {
    const job = await this.prisma.execucaoAgente.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("Demanda não encontrada");
    return this.formatar(job);
  }

  /** Dispara de novo o mesmo pedido, como demanda nova (não mexe na anterior). */
  async repetir(id: string, usuario: { id: string; nome: string }) {
    const anterior = await this.findOne(id);
    return this.criar({ titulo: anterior.titulo, descricao: anterior.descricao, usuario });
  }

  /**
   * Panorama pro topo da tela. `agenteVistoEm` é a última vez que QUALQUER
   * execução foi reivindicada: é como o painel sabe que existe agente vivo do
   * outro lado, sem precisar que ele se anuncie.
   */
  async resumo() {
    const desde24h = new Date(Date.now() - 24 * 3_600_000);
    const [aguardando, executando, ultimas24h, ultimoContato, agregado] = await Promise.all([
      this.prisma.execucaoAgente.count({ where: { status: StatusExecucaoAgente.PENDENTE } }),
      this.prisma.execucaoAgente.count({ where: { status: StatusExecucaoAgente.EXECUTANDO } }),
      this.prisma.execucaoAgente.count({ where: { criadoEm: { gte: desde24h } } }),
      this.prisma.execucaoAgente.findFirst({
        where: { reivindicadoEm: { not: null } },
        orderBy: { reivindicadoEm: "desc" },
        select: { reivindicadoEm: true, workerId: true },
      }),
      this.prisma.execucaoAgente.aggregate({
        where: { finalizadoEm: { gte: desde24h } },
        _sum: { custoUsd: true },
        _avg: { duracaoMs: true },
      }),
    ]);

    return {
      aguardando,
      executando,
      ultimas24h,
      duracaoMediaMs: agregado._avg.duracaoMs ? Math.round(agregado._avg.duracaoMs) : null,
      custoEstimado24h: agregado._sum.custoUsd ? Number(agregado._sum.custoUsd) : 0,
      agenteVistoEm: ultimoContato?.reivindicadoEm ?? null,
      agenteWorkerId: ultimoContato?.workerId ?? null,
    };
  }

  /** Achata o job da fila no formato que a tela consome. */
  private formatar(job: {
    id: string;
    taskId: string;
    status: StatusExecucaoAgente;
    payload: unknown;
    tentativas: number;
    iniciadoEm: Date | null;
    finalizadoEm: Date | null;
    duracaoMs: number | null;
    custoUsd: unknown;
    exitCode: number | null;
    branch: string | null;
    arquivosAlterados: string[];
    resumo: string | null;
    erro: string | null;
    workerId: string | null;
    criadoEm: Date;
  }) {
    const p = (job.payload ?? {}) as Partial<PayloadDemanda>;
    return {
      id: job.id,
      taskId: job.taskId,
      titulo: p.titulo?.trim() || `Demanda ${job.taskId}`,
      descricao: p.descricao ?? "",
      origem: p.origem === "painel" ? "painel" : "webhook",
      criadoPorNome: p.criadoPorNome ?? null,
      status: job.status,
      tentativas: job.tentativas,
      iniciadoEm: job.iniciadoEm,
      finalizadoEm: job.finalizadoEm,
      duracaoMs: job.duracaoMs,
      custoUsd: job.custoUsd != null ? Number(job.custoUsd) : null,
      exitCode: job.exitCode,
      branch: job.branch,
      arquivosAlterados: job.arquivosAlterados,
      // O relato vive em `resumo` quando deu certo e em `erro` quando não — a
      // tela mostra os dois no mesmo lugar, com a cor do status.
      relato: job.resumo ?? job.erro ?? null,
      deuCerto: job.status === StatusExecucaoAgente.CONCLUIDA,
      workerId: job.workerId,
      criadoEm: job.criadoEm,
    };
  }
}
