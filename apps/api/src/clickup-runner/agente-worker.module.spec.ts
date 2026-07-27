import { afterEach, describe, expect, it } from "vitest";
import { criarExecutor } from "./agente-worker.module";
import { StubExecutorAgente } from "./executor/stub.executor";
import { ClaudeCodeExecutor } from "./executor/claude-code.executor";
import { identidadeWorker } from "./worker.service";
import type { RunnerConfig } from "./runner.config";

describe("criarExecutor", () => {
  it("registra o stub quando EXECUTOR_AGENTE=stub", () => {
    expect(criarExecutor({ executor: "stub" } as RunnerConfig)).toBeInstanceOf(StubExecutorAgente);
  });

  it("registra o executor real quando pedido", () => {
    const config = {
      executor: "claude-code",
      dirTrabalho: "/trabalho",
      repoUrl: "https://exemplo/repo.git",
      branchBase: "main",
    } as RunnerConfig;
    expect(criarExecutor(config)).toBeInstanceOf(ClaudeCodeExecutor);
  });

  it("explode no boot com executor desconhecido (não cai em fallback silencioso)", () => {
    expect(() => criarExecutor({ executor: "gpt" } as RunnerConfig)).toThrow(/desconhecido/);
  });
});

describe("identidadeWorker", () => {
  const original = process.env.RUNNER_WORKER_NOME;
  afterEach(() => {
    if (original == null) delete process.env.RUNNER_WORKER_NOME;
    else process.env.RUNNER_WORKER_NOME = original;
  });

  it("usa o nome do serviço quando configurado", () => {
    process.env.RUNNER_WORKER_NOME = "ronan_agente";
    expect(identidadeWorker()).toMatch(/^ronan_agente#[0-9a-f]{8}$/);
  });

  it("cai no host quando não há nome, e nunca colide entre processos", () => {
    delete process.env.RUNNER_WORKER_NOME;
    const a = identidadeWorker();
    const b = identidadeWorker();
    expect(a).toMatch(/^agente@/);
    expect(a).not.toBe(b);
  });
});
