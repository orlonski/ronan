import { Injectable, Logger } from "@nestjs/common";
import { Prisma, StatusExecucaoAgente, type ExecucaoAgente } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RunnerConfig } from "./runner.config";
import type { ResultadoExecucao } from "./executor/executor-agente";

export type ResultadoEnfileirar =
  | { aceito: true; job: ExecucaoAgente }
  | { aceito: false; motivo: "execucao-ativa" | "janela-dedupe"; jobExistente: ExecucaoAgente };

/** Backoff exponencial (30s, 60s, 120s…) com teto de 15 min. */
export function atrasoBackoffMs(tentativa: number): number {
  const base = 30_000 * 2 ** Math.max(0, tentativa - 1);
  return Math.min(base, 15 * 60_000);
}

/**
 * A fila. Vive no Postgres de propósito: o webhook do ClickUp reenvia em
 * timeout, o serviço reinicia no deploy e pode haver mais de uma réplica —
 * nenhuma dessas garantias sobrevive num Map em memória.
 */
@Injectable()
export class FilaExecucoesService {
  private readonly logger = new Logger("ClickupRunner");

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: RunnerConfig,
  ) {}

  /**
   * Enfileira uma execução pra task. Recusa (sem criar nada) quando já existe
   * execução viva pra ela ou quando outra chegou dentro da janela de dedupe.
   *
   * A corrida entre dois webhooks simultâneos é resolvida NO BANCO: `taskAtiva`
   * é única, então a segunda inserção estoura P2002 e vira recusa — nunca duas
   * execuções da mesma task.
   */
  async enfileirar(entrada: {
    taskId: string;
    payload: unknown;
    origemIp?: string;
  }): Promise<ResultadoEnfileirar> {
    const ativa = await this.prisma.execucaoAgente.findUnique({
      where: { taskAtiva: entrada.taskId },
    });
    if (ativa) return { aceito: false, motivo: "execucao-ativa", jobExistente: ativa };

    if (this.config.janelaDedupeMs > 0) {
      const recente = await this.prisma.execucaoAgente.findFirst({
        where: {
          taskId: entrada.taskId,
          criadoEm: { gt: new Date(Date.now() - this.config.janelaDedupeMs) },
        },
        orderBy: { criadoEm: "desc" },
      });
      if (recente) return { aceito: false, motivo: "janela-dedupe", jobExistente: recente };
    }

    try {
      const job = await this.prisma.execucaoAgente.create({
        data: {
          taskId: entrada.taskId,
          taskAtiva: entrada.taskId,
          payload: (entrada.payload ?? {}) as Prisma.InputJsonValue,
          origemIp: entrada.origemIp,
        },
      });
      return { aceito: true, job };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Perdeu a corrida pro índice único: alguém já enfileirou essa task.
        const jobExistente = await this.prisma.execucaoAgente.findUnique({
          where: { taskAtiva: entrada.taskId },
        });
        if (jobExistente) return { aceito: false, motivo: "execucao-ativa", jobExistente };
      }
      throw err;
    }
  }

  /**
   * Reivindica até `limite` execuções pendentes pro worker. `FOR UPDATE SKIP
   * LOCKED` deixa duas réplicas puxarem da mesma fila sem pegar o mesmo item.
   *
   * Nome de tabela/coluna é o do @@map (execucoes_agente) — não o do model.
   */
  async reivindicar(workerId: string, limite: number): Promise<ExecucaoAgente[]> {
    if (limite <= 0) return [];
    return this.prisma.$queryRaw<ExecucaoAgente[]>`
      UPDATE "execucoes_agente"
         SET status = 'EXECUTANDO'::"StatusExecucaoAgente",
             "workerId" = ${workerId},
             "reivindicadoEm" = NOW(),
             "iniciadoEm" = COALESCE("iniciadoEm", NOW()),
             "alteradoEm" = NOW()
       WHERE id IN (
         SELECT id FROM "execucoes_agente"
          WHERE status = 'PENDENTE'::"StatusExecucaoAgente"
            AND ("proximaTentativaEm" IS NULL OR "proximaTentativaEm" <= NOW())
          ORDER BY "criadoEm" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limite}
       )
      RETURNING *;
    `;
  }

  /**
   * Devolve pra fila execuções cuja posse ficou velha. Sem isso, um processo
   * morto no meio da execução trava a task pra sempre (o `taskAtiva` único
   * bloquearia todo webhook seguinte dela).
   */
  async recuperarPresas(): Promise<number> {
    const limite = new Date(Date.now() - this.config.timeoutExecucaoMs - 60_000);
    const { count } = await this.prisma.execucaoAgente.updateMany({
      where: { status: StatusExecucaoAgente.EXECUTANDO, reivindicadoEm: { lt: limite } },
      data: { status: StatusExecucaoAgente.PENDENTE, workerId: null, reivindicadoEm: null },
    });
    if (count > 0) this.logger.warn(`Recuperadas ${count} execução(ões) presa(s) em EXECUTANDO`);
    return count;
  }

  /** Fecha a execução: libera a task (taskAtiva=null) e guarda o resultado. */
  async finalizar(job: ExecucaoAgente, resultado: ResultadoExecucao): Promise<ExecucaoAgente> {
    const inicio = job.iniciadoEm ?? job.criadoEm;
    return this.prisma.execucaoAgente.update({
      where: { id: job.id },
      data: {
        status: StatusExecucaoAgente[resultado.status],
        taskAtiva: null,
        finalizadoEm: new Date(),
        duracaoMs: Date.now() - inicio.getTime(),
        custoUsd: resultado.custoUsd != null ? new Prisma.Decimal(resultado.custoUsd) : null,
        exitCode: resultado.exitCode ?? null,
        branch: resultado.branch ?? null,
        arquivosAlterados: resultado.arquivosAlterados ?? [],
        resumo: resultado.status === "CONCLUIDA" ? resultado.resumo : null,
        erro: resultado.status === "CONCLUIDA" ? null : resultado.resumo,
      },
    });
  }

  /**
   * Reagenda por falha de INFRA. Mantém `taskAtiva` (a execução continua sendo
   * a dona da task) e conta a tentativa. Estourou o teto → o worker finaliza.
   */
  async reagendar(job: ExecucaoAgente, erro: string): Promise<ExecucaoAgente> {
    const tentativas = job.tentativas + 1;
    return this.prisma.execucaoAgente.update({
      where: { id: job.id },
      data: {
        status: StatusExecucaoAgente.PENDENTE,
        tentativas,
        proximaTentativaEm: new Date(Date.now() + atrasoBackoffMs(tentativas)),
        workerId: null,
        reivindicadoEm: null,
        erro: erro.slice(0, 5_000),
      },
    });
  }

  async marcarComentado(id: string): Promise<void> {
    await this.prisma.execucaoAgente.update({
      where: { id },
      data: { comentadoEm: new Date() },
    });
  }

  contarEmExecucao(): Promise<number> {
    return this.prisma.execucaoAgente.count({
      where: { status: StatusExecucaoAgente.EXECUTANDO },
    });
  }
}
