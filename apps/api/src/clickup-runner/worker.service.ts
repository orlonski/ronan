import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ExecucaoAgente } from "@prisma/client";
import { FilaExecucoesService } from "./fila.service";
import { RunnerConfig } from "./runner.config";
import { ClickupComentarioService, montarComentario } from "./clickup-comentario.service";
import {
  EXECUTOR_AGENTE,
  type ExecutorAgente,
  type ResultadoExecucao,
} from "./executor/executor-agente";

/**
 * Branch de trabalho da task. Nunca a principal — regra do próprio escopo.
 *
 * O taskId vem de fora (query do webhook), então o nome é montado só com
 * `[a-zA-Z0-9-_]`: ponto sai fora porque git recusa ref com `..` e com ponto no
 * começo/fim, e isso é justamente o que um id malicioso tentaria.
 */
export function branchDaTask(taskId: string): string {
  const limpo = taskId
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 60);
  return `feat/${limpo || "task"}`;
}

/**
 * Consome a fila: reivindica pendentes, chama o executor com teto de tempo e
 * comenta o desfecho na task — inclusive quando dá errado.
 *
 * Roda no mesmo processo da API porque a fila é pequena e serializada
 * (concorrência default 1). O trabalho pesado de verdade mora no executor, que
 * hoje é o stub.
 */
@Injectable()
export class WorkerExecucoesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ClickupRunner");
  private readonly workerId = randomUUID();
  private emVoo = 0;
  private tickRodando = false;
  private laco?: NodeJS.Timeout;

  constructor(
    private readonly fila: FilaExecucoesService,
    private readonly config: RunnerConfig,
    private readonly comentarios: ClickupComentarioService,
    @Inject(EXECUTOR_AGENTE) private readonly executor: ExecutorAgente,
  ) {}

  onModuleInit(): void {
    this.config.descreverNoBoot();
    if (!this.config.habilitado) return;
    this.laco = setInterval(() => void this.tick(), this.config.intervaloWorkerMs);
    // unref: um loop de fila não pode segurar o processo no shutdown.
    this.laco.unref?.();
  }

  onModuleDestroy(): void {
    if (this.laco) clearInterval(this.laco);
  }

  async tick(): Promise<void> {
    if (!this.config.habilitado || this.tickRodando) return;
    this.tickRodando = true;
    try {
      await this.fila.recuperarPresas();
      const vagas = this.config.concorrencia - this.emVoo;
      const jobs = await this.fila.reivindicar(this.workerId, vagas);
      for (const job of jobs) {
        this.emVoo++;
        // Sem await: o tick não segura a execução (que pode levar minutos).
        void this.processar(job).finally(() => {
          this.emVoo--;
        });
      }
    } catch (err) {
      this.logger.error(
        JSON.stringify({ evento: "tick-erro", erro: (err as Error).message }),
      );
    } finally {
      this.tickRodando = false;
    }
  }

  private async processar(job: ExecucaoAgente): Promise<void> {
    const inicio = Date.now();
    const branch = branchDaTask(job.taskId);
    this.log("iniciado", job, { executor: this.executor.nome, branch, tentativa: job.tentativas + 1 });

    let resultado: ResultadoExecucao;
    try {
      resultado = await this.comTimeout(job, branch);
    } catch (err) {
      // Estouro do executor = falha de INFRA (o agente nem devolveu resultado).
      resultado = {
        status: "FALHOU",
        resumo: `Falha de infraestrutura ao executar: ${(err as Error).message}`,
        branch,
        falhaInfra: true,
      };
    }

    const duracaoMs = Date.now() - inicio;

    // Retentar SÓ infra, e só até o teto. Falha do agente é resultado, não bug.
    if (resultado.falhaInfra && job.tentativas + 1 < this.config.tentativasMax) {
      const reagendado = await this.fila.reagendar(job, resultado.resumo);
      this.log("reagendado", job, {
        duracaoMs,
        tentativas: reagendado.tentativas,
        proximaTentativaEm: reagendado.proximaTentativaEm?.toISOString(),
      });
      return;
    }

    const finalizado = await this.fila.finalizar(job, resultado);
    this.log("finalizado", job, {
      status: resultado.status,
      duracaoMs,
      custoUsd: resultado.custoUsd,
      exitCode: resultado.exitCode,
      arquivos: resultado.arquivosAlterados?.length ?? 0,
    });

    const texto = montarComentario(finalizado, resultado, duracaoMs);
    const comentou = await this.comentarios.comentar(job.taskId, texto);
    if (comentou) await this.fila.marcarComentado(job.id);
  }

  /** Teto duro de tempo. Estourar vira EXCEDEU_LIMITE (não retenta). */
  private async comTimeout(job: ExecucaoAgente, branch: string): Promise<ResultadoExecucao> {
    const ctx = {
      jobId: job.id,
      taskId: job.taskId,
      payload: job.payload,
      branch,
      timeoutMs: this.config.timeoutExecucaoMs,
      orcamentoUsd: this.config.orcamentoUsd,
      tentativa: job.tentativas + 1,
    };

    let timer: NodeJS.Timeout | undefined;
    const estouro = new Promise<ResultadoExecucao>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            status: "EXCEDEU_LIMITE",
            resumo:
              `A execução passou do teto de ${Math.round(this.config.timeoutExecucaoMs / 60_000)} ` +
              "minutos e foi interrompida. Nada foi publicado.",
            branch,
            falhaInfra: false,
          }),
        this.config.timeoutExecucaoMs,
      );
    });

    try {
      return await Promise.race([this.executor.executar(ctx), estouro]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Log estruturado por task — é o que permite auditar depois. */
  private log(evento: string, job: ExecucaoAgente, extra: Record<string, unknown> = {}): void {
    this.logger.log(JSON.stringify({ evento, taskId: job.taskId, jobId: job.id, ...extra }));
  }
}
