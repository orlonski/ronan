import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { ExecucaoAgente } from "@prisma/client";
import { FilaExecucoesService } from "./fila.service";
import { RunnerConfig } from "./runner.config";
import {
  EXECUTOR_AGENTE,
  type ExecutorAgente,
  type ResultadoExecucao,
} from "./executor/executor-agente";
import { FONTE_DEMANDA, type Demanda, type FonteDemanda } from "./fonte/fonte-demanda";

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
 * Identidade deste worker na fila. Vai pra coluna `workerId` de cada execução
 * reivindicada, então é por ela que se enxerga QUEM processou — e o que a API
 * (que só enfileira) nunca deveria escrever.
 */
export function identidadeWorker(): string {
  const nome = process.env.RUNNER_WORKER_NOME?.trim() || `agente@${hostname()}`;
  return `${nome}#${randomUUID().slice(0, 8)}`;
}

/**
 * Consome a fila: reivindica pendentes, chama o executor com teto de tempo e
 * comenta o desfecho na task — inclusive quando dá errado.
 *
 * Roda no processo do **agente** (`agente-main.ts`), não na API: quem recebe o
 * webhook só enfileira. Assim reiniciar/deployar a API não interrompe execução
 * nenhuma, e a capacidade de executar código fica isolada num serviço só dela.
 */
@Injectable()
export class WorkerExecucoesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ClickupRunner");
  private readonly workerId = identidadeWorker();
  private emVoo = 0;
  private tickRodando = false;
  private laco?: NodeJS.Timeout;
  private ultimoAvisoTeto = 0;

  constructor(
    private readonly fila: FilaExecucoesService,
    private readonly config: RunnerConfig,
    @Inject(FONTE_DEMANDA) private readonly fonte: FonteDemanda,
    @Inject(EXECUTOR_AGENTE) private readonly executor: ExecutorAgente,
  ) {}

  onModuleInit(): void {
    this.config.descreverNoBoot("worker");
    if (!this.config.habilitado) return;
    this.logger.log(
      JSON.stringify({
        evento: "worker-iniciado",
        workerId: this.workerId,
        executor: this.executor.nome,
        fonte: this.fonte.nome,
      }),
    );
    // Timer com ref de propósito: no processo do agente NÃO há servidor HTTP
    // segurando o event loop, então um setInterval unref'd deixaria o processo
    // terminar logo depois do boot. Quem encerra é o onModuleDestroy (Nest
    // chama no SIGTERM), não a falta de referência.
    this.laco = setInterval(() => void this.tick(), this.config.intervaloWorkerMs);
  }

  onModuleDestroy(): void {
    if (this.laco) clearInterval(this.laco);
  }

  async tick(): Promise<void> {
    if (!this.config.habilitado || this.tickRodando) return;
    this.tickRodando = true;
    try {
      await this.fila.recuperarPresas();

      // Teto por janela ANTES de reivindicar: item barrado continua PENDENTE e
      // roda quando a janela abrir. É o que impede "mexeram em 40 tasks de uma
      // vez e o agente saiu executando as 40".
      const excedido = await this.tetoExcedido();
      if (excedido) {
        this.avisarTeto(excedido);
        return;
      }

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

  /** Qual teto estourou (se algum). Conta execuções INICIADAS na janela. */
  private async tetoExcedido(): Promise<{ janela: "hora" | "dia"; feitas: number; teto: number } | null> {
    const agora = Date.now();
    const naHora = await this.fila.contarIniciadasDesde(new Date(agora - 3_600_000));
    if (naHora >= this.config.maxPorHora) {
      return { janela: "hora", feitas: naHora, teto: this.config.maxPorHora };
    }
    const noDia = await this.fila.contarIniciadasDesde(new Date(agora - 24 * 3_600_000));
    if (noDia >= this.config.maxPorDia) {
      return { janela: "dia", feitas: noDia, teto: this.config.maxPorDia };
    }
    return null;
  }

  /** Avisa no máximo uma vez por minuto — o tick roda a cada 5s. */
  private avisarTeto(info: { janela: string; feitas: number; teto: number }): void {
    if (Date.now() - this.ultimoAvisoTeto < 60_000) return;
    this.ultimoAvisoTeto = Date.now();
    this.logger.warn(
      JSON.stringify({ evento: "teto-atingido", ...info, acao: "fila segue parada até a janela abrir" }),
    );
  }

  private async processar(job: ExecucaoAgente): Promise<void> {
    const inicio = Date.now();
    const branch = branchDaTask(job.taskId);
    this.log("iniciado", job, {
      executor: this.executor.nome,
      fonte: this.fonte.nome,
      branch,
      tentativa: job.tentativas + 1,
    });

    let resultado: ResultadoExecucao;
    try {
      // Ler a demanda vem antes de executar: sem título/descrição o agente não
      // tem o que fazer. Ferramenta fora do ar é falha de INFRA — reagenda.
      const demanda = await this.fonte.ler(job.taskId, job.payload);
      resultado = await this.comTimeout(job, branch, demanda);
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

    const relatou = await this.fonte.reportar(job.taskId, resultado, {
      job: finalizado,
      duracaoMs,
    });
    if (relatou) await this.fila.marcarComentado(job.id);
  }

  /** Teto duro de tempo. Estourar vira EXCEDEU_LIMITE (não retenta). */
  private async comTimeout(
    job: ExecucaoAgente,
    branch: string,
    demanda: Demanda,
  ): Promise<ResultadoExecucao> {
    const ctx = {
      jobId: job.id,
      taskId: job.taskId,
      payload: job.payload,
      demanda,
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
