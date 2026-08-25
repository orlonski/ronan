import { describe, it, expect, vi } from "vitest";
import { ConferenciaWorkerService } from "./conferencia-worker.service";
import { comConta } from "../common/conta/conta-context";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConferenciaConfig } from "./conferencia.config";

/**
 * Qual modelo lê o ticket de cada empresa.
 *
 * É a peça que permite avaliar um fornecedor novo (MiniMax) sem apostar a
 * plataforma: liga numa empresa, olha os vereditos na tela de Conferência,
 * volta num clique. Se vazar entre contas, o experimento de uma vira o
 * faturamento de outra — foi exatamente o bug que o `CachePorConta` documenta.
 */

function montar(porConta: Record<string, string | null>, padraoEnv = "claude-haiku-4-5-20251001") {
  const findUnique = vi.fn(async (args: { where: { contaId: string } }) => ({
    modeloConferencia: porConta[args.where.contaId] ?? null,
  }));
  const prisma = { configuracaoIa: { findUnique } } as unknown as PrismaService;
  const config = { modeloPadrao: padraoEnv } as unknown as ConferenciaConfig;

  const worker = new ConferenciaWorkerService(
    prisma,
    {} as never,
    config,
    {} as never,
    {} as never,
    {} as never,
  );
  const modeloDaConta = () =>
    (worker as unknown as { modeloDaConta: () => Promise<string> }).modeloDaConta();
  return { modeloDaConta, findUnique };
}

describe("ConferenciaWorkerService.modeloDaConta", () => {
  it("não serve a escolha de uma empresa para outra", async () => {
    const { modeloDaConta } = montar({
      "conta-a": "MiniMax-M3",
      "conta-b": null,
    });

    expect(await comConta("conta-a", modeloDaConta)).toBe("MiniMax-M3");
    expect(await comConta("conta-b", modeloDaConta)).toBe("claude-haiku-4-5-20251001");
  });

  it("sem escolha da empresa, vale o do ambiente", async () => {
    const { modeloDaConta } = montar({}, "claude-sonnet-4-6");
    expect(await comConta("conta-a", modeloDaConta)).toBe("claude-sonnet-4-6");
  });

  it("campo em branco no banco não vira modelo vazio", async () => {
    const { modeloDaConta } = montar({ "conta-a": "   " });
    expect(await comConta("conta-a", modeloDaConta)).toBe("claude-haiku-4-5-20251001");
  });

  it("cacheia dentro da mesma conta — o job dura segundos e roda em fila", async () => {
    const { modeloDaConta, findUnique } = montar({ "conta-a": "MiniMax-M3" });
    await comConta("conta-a", modeloDaConta);
    await comConta("conta-a", modeloDaConta);
    await comConta("conta-a", modeloDaConta);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("banco fora do ar não trava a fila: cai no padrão", async () => {
    const prisma = {
      configuracaoIa: {
        findUnique: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      },
    } as unknown as PrismaService;
    const worker = new ConferenciaWorkerService(
      prisma,
      {} as never,
      { modeloPadrao: "claude-haiku-4-5-20251001" } as unknown as ConferenciaConfig,
      {} as never,
      {} as never,
      {} as never,
    );
    const r = await comConta("conta-a", () =>
      (worker as unknown as { modeloDaConta: () => Promise<string> }).modeloDaConta(),
    );
    expect(r).toBe("claude-haiku-4-5-20251001");
  });
});
