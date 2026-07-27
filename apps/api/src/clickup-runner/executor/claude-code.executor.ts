import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import { RunnerConfig } from "../runner.config";
import { WorkspaceGit } from "./git-workspace";
import { abrirPullRequest } from "./github-pr";
import type { ContextoExecucao, ExecutorAgente, ResultadoExecucao } from "./executor-agente";

/** Saída do `claude -p --output-format json` que nos interessa. */
export type SaidaClaude = {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  stop_reason?: string;
  terminal_reason?: string;
  subtype?: string;
  api_error_status?: number | null;
};

/**
 * Reconhece "bateu o limite da assinatura" no que o CLI devolve.
 *
 * Importa porque o desfecho é diferente: limite não é bug nem falha de infra —
 * insistir com backoff de minutos não resolve janela que reseta em horas, e
 * cada nova tentativa cava mais fundo o mesmo buraco.
 */
export function bateuLimiteDeUso(saida: SaidaClaude, textoBruto: string): boolean {
  if (saida.api_error_status === 429) return true;
  const alvo = `${saida.result ?? ""} ${saida.stop_reason ?? ""} ${saida.terminal_reason ?? ""} ${textoBruto}`.toLowerCase();
  return (
    alvo.includes("usage limit") ||
    alvo.includes("rate limit") ||
    alvo.includes("limite de uso") ||
    alvo.includes("quota")
  );
}

/** Monta o enunciado que vai pro agente. */
export function montarPrompt(ctx: ContextoExecucao): string {
  return [
    `Você está trabalhando a task ${ctx.taskId} do quadro de demandas, num worktree`,
    `isolado já posicionado na branch \`${ctx.branch}\`.`,
    "",
    `# ${ctx.demanda.titulo}`,
    "",
    ctx.demanda.descricao || "(sem descrição — trabalhe pelo título)",
    "",
    "## Regras",
    "- Trabalhe apenas neste worktree; ele já está na branch certa.",
    "- NÃO rode `git commit`, `git push` nem troque de branch — quem versiona é o processo que te chamou.",
    "- Rode o typecheck e os testes que existirem antes de considerar pronto.",
    "- Se a demanda estiver ambígua ou você concluir que não deve ser feita, explique e não invente.",
    "- Termine com um resumo curto do que mudou e por quê.",
  ].join("\n");
}

/**
 * Executor real: prepara um worktree e roda o Claude Code headless dentro dele.
 *
 * Só entra em cena com `EXECUTOR_AGENTE=claude-code`; o default do serviço
 * continua sendo o stub.
 */
@Injectable()
export class ClaudeCodeExecutor implements ExecutorAgente {
  readonly nome = "claude-code";
  private readonly logger = new Logger("ClickupRunner");

  constructor(
    private readonly config: RunnerConfig,
    private readonly workspace = new WorkspaceGit(
      config.dirTrabalho,
      config.repoUrl,
      config.branchBase,
    ),
  ) {}

  async executar(ctx: ContextoExecucao): Promise<ResultadoExecucao> {
    let dir: string;
    try {
      await this.workspace.prepararBase();
      dir = await this.workspace.criarWorktree(ctx.branch);
    } catch (err) {
      // Git indisponível/sem credencial é infra: vale retentar.
      return {
        status: "FALHOU",
        resumo: `Não consegui preparar o workspace: ${(err as Error).message}`,
        branch: ctx.branch,
        falhaInfra: true,
      };
    }

    const { saida, textoBruto, exitCode } = await this.rodarClaude(ctx, dir);

    if (bateuLimiteDeUso(saida, textoBruto)) {
      return {
        status: "EXCEDEU_LIMITE",
        resumo:
          "A execução parou no limite de uso da conta do Claude. Nada foi publicado. " +
          "Dispare de novo quando a janela renovar.",
        branch: ctx.branch,
        exitCode,
        custoUsd: saida.total_cost_usd,
        falhaInfra: false,
      };
    }

    const arquivos = await this.workspace.arquivosAlterados(dir).catch(() => []);
    const falhou = saida.is_error === true || exitCode !== 0;

    // Sem mudança nenhuma não há o que versionar — e isso é um desfecho válido
    // (o agente pode ter concluído que não havia o que fazer).
    if (arquivos.length === 0) {
      return {
        status: falhou ? "FALHOU" : "CONCLUIDA",
        resumo: this.resumir(saida, textoBruto, "Nenhum arquivo foi alterado."),
        branch: ctx.branch,
        arquivosAlterados: [],
        custoUsd: saida.total_cost_usd,
        exitCode,
        falhaInfra: false,
      };
    }

    let commit: string | null = null;
    let diff = "";
    let publicado = false;
    let pr: { url: string; jaExistia: boolean } | null = null;
    let erroPr: string | null = null;
    try {
      commit = await this.workspace.commitar(
        dir,
        `${ctx.demanda.titulo}\n\nTask ${ctx.taskId}, execução automática.`,
      );
      diff = await this.workspace.resumoDiff(dir);
      if (this.config.publicarBranch && commit) {
        await this.workspace.publicar(dir, ctx.branch);
        publicado = true;
      }
    } catch (err) {
      return {
        status: "FALHOU",
        resumo:
          `O agente terminou e alterou ${arquivos.length} arquivo(s), mas falhei ao versionar: ` +
          `${(err as Error).message}. O trabalho está no worktree \`${dir}\`.`,
        branch: ctx.branch,
        arquivosAlterados: arquivos,
        custoUsd: saida.total_cost_usd,
        exitCode,
        falhaInfra: false,
      };
    }

    // PR depois do push e FORA do try acima: falhar aqui não desfaz o trabalho
    // nem invalida a branch já publicada — vira aviso no relato.
    if (publicado && this.config.abrirPr) {
      try {
        pr = await abrirPullRequest({
          repoUrl: this.config.repoUrl,
          token: this.config.githubToken,
          branch: ctx.branch,
          base: this.config.branchBase,
          titulo: ctx.demanda.titulo,
          corpo: this.corpoDoPr(ctx, saida, diff),
        });
      } catch (err) {
        erroPr = (err as Error).message;
        this.logger.warn(
          JSON.stringify({ evento: "pr-falhou", taskId: ctx.taskId, erro: erroPr }),
        );
      }
    }

    const destino = !publicado
      ? `Commit \`${commit}\` feito na branch local \`${ctx.branch}\` — **push desligado**, nada foi pro GitHub.`
      : pr
        ? `${pr.jaExistia ? "PR já aberto" : "PR aberto"}: ${pr.url} (branch \`${ctx.branch}\`, commit \`${commit}\`).`
        : erroPr
          ? `Branch \`${ctx.branch}\` publicada (commit \`${commit}\`), mas **não consegui abrir o PR**: ${erroPr}`
          : `Branch \`${ctx.branch}\` publicada (commit \`${commit}\`).`;

    return {
      status: falhou ? "FALHOU" : "CONCLUIDA",
      resumo: this.resumir(saida, textoBruto, `${destino}${diff ? `\n\n\`\`\`\n${diff}\n\`\`\`` : ""}`),
      branch: ctx.branch,
      arquivosAlterados: arquivos,
      custoUsd: saida.total_cost_usd,
      exitCode,
      falhaInfra: false,
    };
  }

  /** Roda o CLI e devolve o JSON já parseado (mais o texto cru, pro diagnóstico). */
  protected rodarClaude(
    ctx: ContextoExecucao,
    dir: string,
  ): Promise<{ saida: SaidaClaude; textoBruto: string; exitCode: number }> {
    const args = [
      "-p",
      montarPrompt(ctx),
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      ...this.config.ferramentas,
    ];
    // Só entra se alguém configurar de propósito: com token de assinatura não há
    // cobrança por execução, e passar teto em dólar daria a impressão errada de
    // que o serviço gasta em API.
    if (this.config.orcamentoUsd > 0) {
      args.push("--max-budget-usd", String(this.config.orcamentoUsd));
    }
    if (this.config.modelo) args.push("--model", this.config.modelo);

    this.logger.log(
      JSON.stringify({
        evento: "claude-iniciando",
        taskId: ctx.taskId,
        dir,
        ferramentas: this.config.ferramentas,
      }),
    );

    return new Promise((resolve) => {
      // Nunca `--bare`: essa flag força ANTHROPIC_API_KEY e ignora o token de
      // assinatura, que é justamente como este serviço autentica.
      const filho = execFile(
        "claude",
        args,
        {
          cwd: dir,
          maxBuffer: 50 * 1024 * 1024,
          // O timeout duro de verdade é o do worker; este é folga pra ele
          // conseguir matar antes com mensagem melhor.
          timeout: ctx.timeoutMs + 30_000,
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: undefined,
            // O agente roda SEM credencial de git. Não é confiança no prompt:
            // o credential.helper lê GITHUB_TOKEN do ambiente, e sem ele
            // qualquer `git push` que ele tente — inclusive na main — falha na
            // autenticação. Quem publica é este processo, depois, e só a branch
            // da task.
            GITHUB_TOKEN: undefined,
          } as NodeJS.ProcessEnv,
        },
        (erro, stdout, stderr) => {
          const textoBruto = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
          let saida: SaidaClaude = {};
          try {
            saida = JSON.parse(stdout || "{}") as SaidaClaude;
          } catch {
            // Sem JSON parseável, o texto cru é o que temos pro relato.
            saida = { is_error: true, result: textoBruto.slice(0, 4_000) };
          }
          const exitCode =
            (erro as (Error & { code?: number }) | null)?.code ?? (saida.is_error ? 1 : 0);
          resolve({ saida, textoBruto, exitCode: typeof exitCode === "number" ? exitCode : 1 });
        },
      );
      filho.stdin?.end();
    });
  }

  /** Corpo do PR: o que o agente relatou + o diff, com a origem da demanda. */
  private corpoDoPr(ctx: ContextoExecucao, saida: SaidaClaude, diff: string): string {
    return [
      `Execução automática da task \`${ctx.taskId}\`.`,
      "",
      `**Demanda:** ${ctx.demanda.titulo}`,
      ctx.demanda.descricao ? `\n${ctx.demanda.descricao}\n` : "",
      "---",
      "",
      (saida.result ?? "").trim().slice(0, 20_000),
      diff ? `\n\`\`\`\n${diff}\n\`\`\`` : "",
      "",
      "_Gerado pelo agente. Revise antes de mesclar._",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private resumir(saida: SaidaClaude, textoBruto: string, rodape: string): string {
    const relato = (saida.result ?? textoBruto).trim().slice(0, 6_000);
    const metrica = [
      saida.num_turns != null ? `${saida.num_turns} turno(s)` : null,
      saida.total_cost_usd != null
        ? `≈ US$ ${saida.total_cost_usd.toFixed(2)} em tokens (estimativa do CLI; na assinatura não vira cobrança)`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return [relato, "", rodape, metrica ? `\n_${metrica}_` : ""].filter(Boolean).join("\n");
  }
}
