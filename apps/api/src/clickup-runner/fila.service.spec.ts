import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { FilaExecucoesService, atrasoBackoffMs } from "./fila.service";
import type { RunnerConfig } from "./runner.config";
import type { PrismaService } from "../prisma/prisma.service";

function prismaFake(over: Record<string, unknown> = {}) {
  const execucaoAgente = {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "job-1", tentativas: 0, criadoEm: new Date(), ...data }),
    ),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
    ...over,
  };
  return { execucaoAgente } as unknown as PrismaService & {
    execucaoAgente: typeof execucaoAgente;
  };
}

const config = { janelaDedupeMs: 600_000, timeoutExecucaoMs: 60_000 } as RunnerConfig;

describe("FilaExecucoesService.enfileirar", () => {
  it("aceita a primeira chegada", async () => {
    const prisma = prismaFake();
    const fila = new FilaExecucoesService(prisma, config);

    const r = await fila.enfileirar({ taskId: "abc123", payload: { a: 1 } });

    expect(r.aceito).toBe(true);
    expect(prisma.execucaoAgente.create).toHaveBeenCalledOnce();
    // taskAtiva espelha o taskId: é o que trava a 2ª execução no banco.
    const args = prisma.execucaoAgente.create.mock.calls[0]![0] as { data: { taskAtiva: string } };
    expect(args.data.taskAtiva).toBe("abc123");
  });

  it("recusa quando já existe execução ativa pra task", async () => {
    const prisma = prismaFake({
      findUnique: vi.fn().mockResolvedValue({ id: "job-antigo" }),
    });
    const fila = new FilaExecucoesService(prisma, config);

    const r = await fila.enfileirar({ taskId: "abc123", payload: {} });

    expect(r).toMatchObject({ aceito: false, motivo: "execucao-ativa" });
    expect(prisma.execucaoAgente.create).not.toHaveBeenCalled();
  });

  it("recusa reenvio dentro da janela de dedupe (2 requisições em 1 min = 1 execução)", async () => {
    const prisma = prismaFake({
      findFirst: vi.fn().mockResolvedValue({ id: "job-de-agora-a-pouco" }),
    });
    const fila = new FilaExecucoesService(prisma, config);

    const r = await fila.enfileirar({ taskId: "abc123", payload: {} });

    expect(r).toMatchObject({ aceito: false, motivo: "janela-dedupe" });
    expect(prisma.execucaoAgente.create).not.toHaveBeenCalled();
  });

  it("recusa quando perde a corrida no índice único (dois webhooks simultâneos)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "6",
    });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // checagem inicial: ninguém ativo
      .mockResolvedValueOnce({ id: "job-do-vencedor" }); // após o P2002
    const prisma = prismaFake({
      findUnique,
      create: vi.fn().mockRejectedValue(p2002),
    });
    const fila = new FilaExecucoesService(prisma, config);

    const r = await fila.enfileirar({ taskId: "abc123", payload: {} });

    expect(r).toMatchObject({ aceito: false, motivo: "execucao-ativa" });
  });
});

describe("FilaExecucoesService.finalizar", () => {
  it("libera a task (taskAtiva null) e guarda o desfecho", async () => {
    const prisma = prismaFake();
    const fila = new FilaExecucoesService(prisma, config);
    const job = {
      id: "job-1",
      iniciadoEm: new Date(Date.now() - 1_000),
      criadoEm: new Date(),
    } as never;

    await fila.finalizar(job, {
      status: "CONCLUIDA",
      resumo: "feito",
      arquivosAlterados: ["a.ts"],
      branch: "feat/x",
      custoUsd: 0.42,
      exitCode: 0,
    });

    const args = prisma.execucaoAgente.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.taskAtiva).toBeNull();
    expect(args.data.status).toBe("CONCLUIDA");
    expect(args.data.resumo).toBe("feito");
    expect(args.data.erro).toBeNull();
    expect(args.data.arquivosAlterados).toEqual(["a.ts"]);
  });

  it("guarda o texto em `erro` quando não concluiu", async () => {
    const prisma = prismaFake();
    const fila = new FilaExecucoesService(prisma, config);
    const job = { id: "job-1", iniciadoEm: new Date(), criadoEm: new Date() } as never;

    await fila.finalizar(job, { status: "FALHOU", resumo: "deu ruim" });

    const args = prisma.execucaoAgente.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.erro).toBe("deu ruim");
    expect(args.data.resumo).toBeNull();
  });
});

describe("atrasoBackoffMs", () => {
  it("cresce exponencialmente e para no teto de 15 min", () => {
    expect(atrasoBackoffMs(1)).toBe(30_000);
    expect(atrasoBackoffMs(2)).toBe(60_000);
    expect(atrasoBackoffMs(3)).toBe(120_000);
    expect(atrasoBackoffMs(20)).toBe(15 * 60_000);
  });
});
