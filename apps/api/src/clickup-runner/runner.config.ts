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
  /** De onde vem a demanda ("clickup" ou "payload"). */
  readonly fonte: string;

  // --- executor real (claude-code) ---
  /** Volume onde ficam o clone base e os worktrees. */
  readonly dirTrabalho: string;
  readonly repoUrl: string;
  readonly branchBase: string;
  /** Ferramentas liberadas pro agente (vira --allowedTools). */
  readonly ferramentas: string[];
  /** Modelo, quando quiser fixar. Vazio = default do CLI. */
  readonly modelo: string;
  /**
   * Publicar a branch no remoto ao fim. Default FALSO: o agente começa
   * trabalhando sem poder mandar nada pra fora, e o relato leva o diff.
   */
  readonly publicarBranch: boolean;
  /** Abrir PR da branch contra a base ao publicar. Só vale com push ligado. */
  readonly abrirPr: boolean;
  /** Token do GitHub (mesmo do git). Necessário pra API de PR. */
  readonly githubToken: string;
  /** Tetos de quantas execuções podem rodar por janela. */
  readonly maxPorHora: number;
  readonly maxPorDia: number;

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
      15 * 60_000,
      60_000,
      4 * 60 * 60_000,
    );
    // 0 = NÃO passa --max-budget-usd pro CLI (default).
    //
    // Este serviço autentica por assinatura (CLAUDE_CODE_OAUTH_TOKEN), então não
    // existe fatura por execução: o consumo bate no plano mensal. Falar em dólar
    // aqui só confundiria. Os freios de verdade são o timeout duro e o teto de
    // execuções por janela. Quem usar chave de API pode ligar setando um valor.
    this.orcamentoUsd = this.numero("CLICKUP_RUNNER_ORCAMENTO_USD", 0, 0, 200);
    this.rateLimitPorMinuto = this.numero("CLICKUP_RUNNER_RATE_LIMIT", 30, 1, 1000);
    this.intervaloWorkerMs = this.numero("CLICKUP_RUNNER_INTERVALO_MS", 5_000, 1_000, 300_000);
    this.executor = (this.config.get<string>("EXECUTOR_AGENTE") ?? "stub").trim().toLowerCase();
    this.fonte = (this.config.get<string>("FONTE_DEMANDA") ?? "clickup").trim().toLowerCase();

    this.dirTrabalho = this.config.get<string>("AGENTE_DIR_TRABALHO") ?? "/trabalho";
    this.repoUrl =
      this.config.get<string>("AGENTE_REPO_URL") ?? "https://github.com/orlonski/ronan.git";
    this.branchBase = this.config.get<string>("AGENTE_BRANCH_BASE") ?? "main";
    this.ferramentas = (
      this.config.get<string>("AGENTE_FERRAMENTAS") ??
      // git só de leitura na allowlist: diagnóstico sim, publicar não. Some
      // com `git` genérico de propósito — o push é do worker, não do agente.
      "Read,Edit,Write,Grep,Glob,Bash(git status*),Bash(git diff*),Bash(git log*)," +
        "Bash(pnpm *),Bash(node *),Bash(npx *)"
    )
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    this.modelo = this.config.get<string>("AGENTE_MODELO") ?? "";
    this.publicarBranch = (this.config.get<string>("AGENTE_PUSH") ?? "").trim() === "true";
    // Default LIGADO, mas só tem efeito com push ligado: branch publicada e
    // largada no remoto não ajuda ninguém.
    this.abrirPr = (this.config.get<string>("AGENTE_ABRIR_PR") ?? "true").trim() !== "false";
    this.githubToken = this.config.get<string>("GITHUB_TOKEN") ?? "";
    this.maxPorHora = this.numero("AGENTE_MAX_POR_HORA", 5, 1, 200);
    this.maxPorDia = this.numero("AGENTE_MAX_POR_DIA", 20, 1, 1000);
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
      `Worker do agente ligado (executor=${this.executor}, fonte=${this.fonte}, ` +
        `concorrência=${this.concorrencia}, ` +
        `tentativas=${this.tentativasMax}, timeout=${Math.round(this.timeoutExecucaoMs / 60_000)}min, ` +
        (this.orcamentoUsd > 0 ? `orçamento=US$ ${this.orcamentoUsd}, ` : "") +
        `tetos=${this.maxPorHora}/h ${this.maxPorDia}/dia, ` +
        `push=${this.publicarBranch ? "LIGADO" : "desligado"}` +
        (this.publicarBranch ? `, PR=${this.abrirPr ? "automático" : "manual"}` : "") +
        (this.fonte === "clickup"
          ? `, comentário=${this.clickupToken ? "configurado" : "SEM TOKEN (não vai comentar)"})`
          : ")"),
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
