import { describe, expect, it, vi } from "vitest";
import { ClaudeCodeExecutor, bateuLimiteDeUso, montarPrompt } from "./claude-code.executor";
import type { SaidaClaude } from "./claude-code.executor";
import type { WorkspaceGit } from "./git-workspace";
import type { RunnerConfig } from "../runner.config";
import type { ContextoExecucao } from "./executor-agente";

const ctx: ContextoExecucao = {
  jobId: "job-1",
  taskId: "86bb3pm4w",
  demanda: { titulo: "Corrigir o filtro", descricao: "campo aparece vazio ao voltar" },
  payload: {},
  branch: "feat/86bb3pm4w",
  timeoutMs: 900_000,
  orcamentoUsd: 0,
  tentativa: 1,
};

function config(over: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    dirTrabalho: "/trabalho",
    repoUrl: "https://exemplo/repo.git",
    branchBase: "main",
    ferramentas: ["Read", "Edit"],
    modelo: "",
    publicarBranch: false,
    orcamentoUsd: 0,
    ...over,
  } as RunnerConfig;
}

/** Executor com o CLI substituído — testa a lógica sem gastar execução real. */
class ExecutorFalso extends ClaudeCodeExecutor {
  constructor(
    cfg: RunnerConfig,
    ws: WorkspaceGit,
    private readonly saida: { saida: SaidaClaude; textoBruto: string; exitCode: number },
  ) {
    super(cfg, ws);
  }
  protected rodarClaude() {
    return Promise.resolve(this.saida);
  }
}

function workspaceFalso(over: Partial<Record<keyof WorkspaceGit, unknown>> = {}) {
  return {
    prepararBase: vi.fn().mockResolvedValue(undefined),
    criarWorktree: vi.fn().mockResolvedValue("/trabalho/wt/feat__86bb3pm4w"),
    arquivosAlterados: vi.fn().mockResolvedValue(["src/a.ts"]),
    commitar: vi.fn().mockResolvedValue("abc1234"),
    resumoDiff: vi.fn().mockResolvedValue(" src/a.ts | 3 +++"),
    publicar: vi.fn().mockResolvedValue(undefined),
    removerWorktree: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as WorkspaceGit & Record<string, ReturnType<typeof vi.fn>>;
}

const sucesso = {
  saida: { is_error: false, result: "Ajustei o combobox.", total_cost_usd: 0.12, num_turns: 7 },
  textoBruto: "",
  exitCode: 0,
};

describe("bateuLimiteDeUso", () => {
  it("reconhece 429 e as mensagens de limite", () => {
    expect(bateuLimiteDeUso({ api_error_status: 429 }, "")).toBe(true);
    expect(bateuLimiteDeUso({ result: "Claude usage limit reached" }, "")).toBe(true);
    expect(bateuLimiteDeUso({}, "rate limit exceeded")).toBe(true);
  });

  it("não confunde execução normal com limite", () => {
    expect(bateuLimiteDeUso({ is_error: false, result: "pronto" }, "")).toBe(false);
  });
});

describe("montarPrompt", () => {
  it("leva título, descrição e a proibição de versionar", () => {
    const p = montarPrompt(ctx);
    expect(p).toContain("Corrigir o filtro");
    expect(p).toContain("campo aparece vazio ao voltar");
    expect(p).toContain("NÃO rode `git commit`");
  });

  it("não trava quando a task não tem descrição", () => {
    const p = montarPrompt({ ...ctx, demanda: { titulo: "Só título", descricao: "" } });
    expect(p).toContain("sem descrição");
  });
});

describe("ClaudeCodeExecutor", () => {
  it("commita na branch da task e NÃO publica com push desligado", async () => {
    const ws = workspaceFalso();
    const r = await new ExecutorFalso(config(), ws, sucesso).executar(ctx);

    expect(r.status).toBe("CONCLUIDA");
    expect(ws.commitar).toHaveBeenCalledOnce();
    expect(ws.publicar).not.toHaveBeenCalled();
    expect(r.resumo).toContain("push desligado");
    expect(r.arquivosAlterados).toEqual(["src/a.ts"]);
  });

  it("publica só a branch da task quando o push está ligado", async () => {
    const ws = workspaceFalso();
    const r = await new ExecutorFalso(config({ publicarBranch: true }), ws, sucesso).executar(ctx);

    expect(ws.publicar).toHaveBeenCalledWith("/trabalho/wt/feat__86bb3pm4w", "feat/86bb3pm4w");
    expect(r.resumo).toContain("publicada");
  });

  it("conclui sem commitar quando o agente não mexeu em nada", async () => {
    const ws = workspaceFalso({ arquivosAlterados: vi.fn().mockResolvedValue([]) });
    const r = await new ExecutorFalso(config(), ws, sucesso).executar(ctx);

    expect(r.status).toBe("CONCLUIDA");
    expect(ws.commitar).not.toHaveBeenCalled();
    expect(r.resumo).toContain("Nenhum arquivo foi alterado");
  });

  it("trata limite de uso como EXCEDEU_LIMITE, sem retentar", async () => {
    const ws = workspaceFalso();
    const r = await new ExecutorFalso(config(), ws, {
      saida: { is_error: true, result: "Claude usage limit reached" },
      textoBruto: "",
      exitCode: 1,
    }).executar(ctx);

    expect(r.status).toBe("EXCEDEU_LIMITE");
    expect(r.falhaInfra).toBe(false);
    expect(ws.commitar).not.toHaveBeenCalled();
  });

  it("falha de git na preparação é INFRA (vale retentar)", async () => {
    const ws = workspaceFalso({
      prepararBase: vi.fn().mockRejectedValue(new Error("Could not resolve host")),
    });
    const r = await new ExecutorFalso(config(), ws, sucesso).executar(ctx);

    expect(r.falhaInfra).toBe(true);
    expect(r.resumo).toContain("workspace");
  });

  it("agente que errou ainda reporta o que mexeu (não engole o trabalho)", async () => {
    const ws = workspaceFalso();
    const r = await new ExecutorFalso(config(), ws, {
      saida: { is_error: true, result: "não consegui terminar" },
      textoBruto: "",
      exitCode: 1,
    }).executar(ctx);

    expect(r.status).toBe("FALHOU");
    expect(r.falhaInfra).toBe(false); // erro do agente não retenta
    expect(r.resumo).toContain("não consegui terminar");
    expect(r.arquivosAlterados).toEqual(["src/a.ts"]);
  });

  it("não perde o trabalho quando o versionamento falha", async () => {
    const ws = workspaceFalso({
      commitar: vi.fn().mockRejectedValue(new Error("index.lock existe")),
    });
    const r = await new ExecutorFalso(config(), ws, sucesso).executar(ctx);

    expect(r.status).toBe("FALHOU");
    expect(r.resumo).toContain("worktree");
    expect(r.arquivosAlterados).toEqual(["src/a.ts"]);
  });
});
