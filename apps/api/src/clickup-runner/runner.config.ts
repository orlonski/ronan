import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Configuração do runner de tasks do ClickUp. Tudo por variável de ambiente —
 * nada de segredo em arquivo versionado.
 *
 * O runner nasce DESLIGADO: sem `CLICKUP_RUNNER_TOKEN` o webhook recusa tudo
 * (401) e o worker nem roda. Assim subir esse código em produção não liga nada
 * sozinho.
 */
@Injectable()
export class RunnerConfig {
  private readonly logger = new Logger("ClickupRunner");

  /** Segredo compartilhado esperado no header X-Runner-Token. */
  readonly token: string;
  /** Segmento secreto opcional na URL (path não-adivinhável). */
  readonly segredoPath: string;
  /** Token pessoal do ClickUp pra comentar de volta na task. */
  readonly clickupToken: string;
  readonly clickupApiUrl: string;

  /** Execuções simultâneas no total (por task já é sempre 1). */
  readonly concorrencia: number;
  /** Janela de dedupe: webhook repetido da MESMA task dentro dela é recusado. */
  readonly janelaDedupeMs: number;
  /** Tentativas por falha de INFRA (falha do agente nunca retenta). */
  readonly tentativasMax: number;
  /** Teto de tempo de uma execução, passado pro executor. */
  readonly timeoutExecucaoMs: number;
  /** Teto de gasto de uma execução, passado pro executor. */
  readonly orcamentoUsd: number;
  /** Requisições por minuto aceitas de um mesmo IP. */
  readonly rateLimitPorMinuto: number;
  /** Intervalo do loop do worker. */
  readonly intervaloWorkerMs: number;
  /** Qual executor o agente registra ("stub" hoje). */
  readonly executor: string;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>("CLICKUP_RUNNER_TOKEN") ?? "";
    this.segredoPath = this.config.get<string>("CLICKUP_RUNNER_PATH_SEGREDO") ?? "";
    this.clickupToken = this.config.get<string>("CLICKUP_API_TOKEN") ?? "";
    this.clickupApiUrl =
      this.config.get<string>("CLICKUP_API_URL") ?? "https://api.clickup.com/api/v2";

    this.concorrencia = this.numero("CLICKUP_RUNNER_CONCORRENCIA", 1, 1, 10);
    this.janelaDedupeMs = this.numero("CLICKUP_RUNNER_JANELA_DEDUPE_MS", 10 * 60_000, 0, 3_600_000);
    this.tentativasMax = this.numero("CLICKUP_RUNNER_TENTATIVAS_MAX", 3, 1, 10);
    this.timeoutExecucaoMs = this.numero(
      "CLICKUP_RUNNER_TIMEOUT_MS",
      30 * 60_000,
      60_000,
      4 * 60 * 60_000,
    );
    this.orcamentoUsd = this.numero("CLICKUP_RUNNER_ORCAMENTO_USD", 5, 0.1, 200);
    this.rateLimitPorMinuto = this.numero("CLICKUP_RUNNER_RATE_LIMIT", 30, 1, 1000);
    this.intervaloWorkerMs = this.numero("CLICKUP_RUNNER_INTERVALO_MS", 5_000, 1_000, 300_000);
    this.executor = (this.config.get<string>("EXECUTOR_AGENTE") ?? "stub").trim().toLowerCase();
  }

  /** Runner ligado? Sem segredo compartilhado não há webhook nem worker. */
  get habilitado(): boolean {
    return this.token.length > 0;
  }

  /**
   * Loga o estado SEM vazar segredo (só o que está setado, nunca o valor).
   * O papel distingue os dois processos: a API só enfileira, o agente processa.
   */
  descreverNoBoot(papel: "webhook" | "worker"): void {
    if (!this.habilitado) {
      this.logger.log(
        papel === "webhook"
          ? "Webhook do ClickUp DESLIGADO (falta CLICKUP_RUNNER_TOKEN): responde 401."
          : "Worker do agente DESLIGADO (falta CLICKUP_RUNNER_TOKEN): não consome a fila.",
      );
      return;
    }
    if (papel === "webhook") {
      this.logger.log(
        `Webhook do ClickUp ligado (dedupe=${Math.round(this.janelaDedupeMs / 1000)}s, ` +
          `pathSecreto=${this.segredoPath ? "sim" : "não"}). ` +
          "O processamento é do serviço do agente — esta API só enfileira.",
      );
      return;
    }
    this.logger.log(
      `Worker do agente ligado (executor=${this.executor}, concorrência=${this.concorrencia}, ` +
        `tentativas=${this.tentativasMax}, timeout=${Math.round(this.timeoutExecucaoMs / 60_000)}min, ` +
        `orçamento=US$ ${this.orcamentoUsd}, ` +
        `comentário=${this.clickupToken ? "configurado" : "SEM TOKEN (não vai comentar)"})`,
    );
  }

  private numero(chave: string, padrao: number, min: number, max: number): number {
    const bruto = this.config.get<string>(chave);
    if (bruto == null || bruto === "") return padrao;
    const n = Number(bruto);
    if (!Number.isFinite(n)) {
      this.logger.warn(`${chave} inválido ("${bruto}"), usando ${padrao}`);
      return padrao;
    }
    return Math.min(max, Math.max(min, n));
  }
}
