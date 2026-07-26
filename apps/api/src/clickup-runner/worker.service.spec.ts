import { describe, expect, it, vi } from "vitest";
import { WorkerExecucoesService, branchDaTask } from "./worker.service";
import type { FilaExecucoesService } from "./fila.service";
import type { FonteDemanda } from "./fonte/fonte-demanda";
import type { RunnerConfig } from "./runner.config";
import type {
  ContextoExecucao,
  ExecutorAgente,
  ResultadoExecucao,
} from "./executor/executor-agente";

const job = {
  id: "job-1",
  taskId: "86bb3pm4w",
  tentativas: 0,
  payload: {},
  iniciadoEm: new Date(),
  criadoEm: new Date(),
} as never;

function montarWorker(
  executar: (ctx: ContextoExecucao) => Promise<ResultadoExecucao>,
  overConfig: Partial<RunnerConfig> = {},
) {
  // Os espiões ficam em variáveis próprias: o cast pro tipo do serviço esconde
  // `.mock` se a gente for buscar o método pelo objeto.
  const finalizar = vi
    .fn()
    .mockImplementation((j: object, r: object) => Promise.resolve({ ...j, ...r }));
  const reagendar = vi.fn().mockResolvedValue({ tentativas: 1, proximaTentativaEm: new Date() });
  const marcarComentado = vi.fn().mockResolvedValue(undefined);
  const reportar = vi.fn().mockResolvedValue(true);
  const ler = vi.fn().mockResolvedValue({ titulo: "Titulo da task", descricao: "descrição" });

  const fila = {
    finalizar,
    reagendar,
    marcarComentado,
    recuperarPresas: vi.fn().mockResolvedValue(0),
    reivindicar: vi.fn().mockResolvedValue([]),
  } as unknown as FilaExecucoesService;

  const fonte = { nome: "fake", ler, reportar } as unknown as FonteDemanda;

  const config = {
    habilitado: true,
    concorrencia: 1,
    tentativasMax: 3,
    timeoutExecucaoMs: 60_000,
    orcamentoUsd: 5,
    intervaloWorkerMs: 5_000,
    ...overConfig,
  } as RunnerConfig;

  const executor: ExecutorAgente = { nome: "fake", executar };
  const worker = new WorkerExecucoesService(fila, config, fonte, executor);
  return { worker, finalizar, reagendar, marcarComentado, reportar, ler };
}

/** Texto que o provider receberia: o worker entrega o resultado, não a string. */
function reportarTexto(reportar: { mock: { calls: unknown[][] } }): string {
  const chamada = reportar.mock.calls[0] as [string, { status: string; resumo: string }, unknown];
  return `${chamada[1].status} ${chamada[1].resumo}`;
}

/** `processar` é privado; o teste chama por dentro de propósito — é o miolo. */
function processar(worker: WorkerExecucoesService, alvo = job) {
  return (worker as unknown as { processar: (j: unknown) => Promise<void> }).processar(alvo);
}

describe("branchDaTask", () => {
  it("usa o prefixo feat/ e sanitiza o id", () => {
    expect(branchDaTask("86bb3pm4w")).toBe("feat/86bb3pm4w");
  });

  it("produz ref válida mesmo com id hostil (nada de '..', barra ou espaço)", () => {
    const branch = branchDaTask("../etc/passwd; rm -rf");
    expect(branch).toBe("feat/etc-passwd-rm-rf");
    expect(branch).not.toContain("..");
    expect(branch.slice("feat/".length)).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("não gera branch vazia quando o id só tem lixo", () => {
    expect(branchDaTask("///")).toBe("feat/task");
  });
});

describe("WorkerExecucoesService.processar", () => {
  it("conclui, finaliza e comenta na task", async () => {
    const { worker, finalizar, reagendar, marcarComentado, reportar, ler } = montarWorker(async () => ({
      status: "CONCLUIDA",
      resumo: "implementei X",
      arquivosAlterados: ["src/a.ts"],
      branch: "feat/86bb3pm4w",
    }));

    await processar(worker);

    expect(finalizar).toHaveBeenCalledOnce();
    expect(reportar).toHaveBeenCalledOnce();
    expect(reportar.mock.calls[0]![0]).toBe("86bb3pm4w");
    expect(reportarTexto(reportar)).toContain("implementei X");
    expect(marcarComentado).toHaveBeenCalledOnce();
  });

  it("comenta também quando o agente falha (silêncio é o pior resultado)", async () => {
    const { worker, finalizar, reagendar, marcarComentado, reportar, ler } = montarWorker(async () => ({
      status: "FALHOU",
      resumo: "o agente não conseguiu",
    }));

    await processar(worker);

    expect(finalizar).toHaveBeenCalledOnce();
    expect(reagendar).not.toHaveBeenCalled(); // falha do agente NÃO retenta
    expect(reportarTexto(reportar)).toContain("FALHOU");
  });

  it("comenta quando o executor explode (erro não engolido)", async () => {
    const { worker, finalizar, reagendar, marcarComentado, reportar, ler } = montarWorker(
      async () => {
        throw new Error("container sumiu");
      },
      { tentativasMax: 1 }, // sem retry sobrando: finaliza direto
    );

    await processar(worker);

    expect(finalizar).toHaveBeenCalledOnce();
    expect(reportarTexto(reportar)).toContain("container sumiu");
  });

  it("reagenda com backoff em falha de INFRA, sem comentar ainda", async () => {
    const { worker, finalizar, reagendar, marcarComentado, reportar, ler } = montarWorker(async () => ({
      status: "FALHOU",
      resumo: "rede caiu",
      falhaInfra: true,
    }));

    await processar(worker);

    expect(reagendar).toHaveBeenCalledOnce();
    expect(finalizar).not.toHaveBeenCalled();
    expect(reportar).not.toHaveBeenCalled();
  });

  it("desiste e comenta quando a falha de infra esgota as tentativas", async () => {
    const { worker, finalizar, reagendar, marcarComentado, reportar, ler } = montarWorker(
      async () => ({ status: "FALHOU", resumo: "rede caiu de novo", falhaInfra: true }),
      { tentativasMax: 2 },
    );

    await processar(worker, { ...(job as object), tentativas: 1 } as never);

    expect(reagendar).not.toHaveBeenCalled();
    expect(finalizar).toHaveBeenCalledOnce();
    expect(reportar).toHaveBeenCalledOnce();
  });

  it("corta no teto de tempo e reporta EXCEDEU_LIMITE", async () => {
    const { worker, finalizar, reagendar, marcarComentado, reportar, ler } = montarWorker(
      () => new Promise(() => {}), // nunca resolve
      { timeoutExecucaoMs: 20 },
    );

    await processar(worker);

    const [, resultado] = finalizar.mock.calls[0]! as [unknown, ResultadoExecucao];
    expect(resultado.status).toBe("EXCEDEU_LIMITE");
    expect(reportarTexto(reportar)).toContain("EXCEDEU_LIMITE");
  });

  it("entrega a demanda lida pro executor (é o enunciado do trabalho)", async () => {
    let recebido: ContextoExecucao | undefined;
    const { worker } = montarWorker(async (ctx) => {
      recebido = ctx;
      return { status: "CONCLUIDA", resumo: "ok" };
    });

    await processar(worker);

    expect(recebido?.demanda).toEqual({ titulo: "Titulo da task", descricao: "descrição" });
    expect(recebido?.branch).toBe("feat/86bb3pm4w");
  });

  it("reagenda quando não consegue LER a demanda (ferramenta fora do ar)", async () => {
    const { worker, reagendar, finalizar, reportar, ler } = montarWorker(async () => ({
      status: "CONCLUIDA",
      resumo: "não deveria chegar aqui",
    }));
    ler.mockRejectedValue(new Error("ClickUp devolveu 500"));

    await processar(worker);

    expect(reagendar).toHaveBeenCalledOnce();
    expect(finalizar).not.toHaveBeenCalled();
    expect(reportar).not.toHaveBeenCalled();
  });

  it("não marca como comentado quando o ClickUp recusou o comentário", async () => {
    const { worker, finalizar, reagendar, marcarComentado, reportar, ler } = montarWorker(async () => ({
      status: "CONCLUIDA",
      resumo: "ok",
    }));
    reportar.mockResolvedValue(false);

    await processar(worker);

    expect(marcarComentado).not.toHaveBeenCalled();
  });
});
