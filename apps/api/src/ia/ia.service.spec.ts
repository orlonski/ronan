import { describe, it, expect, vi } from "vitest";
import { IaService } from "./ia.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import type { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../prisma/prisma.service";
import type { UsoIaService } from "./uso-ia.service";

/**
 * Config sem `ANTHROPIC_API_KEY`: o client não é construído e nenhum teste aqui
 * encosta na rede. `modeloAtual` não depende do client.
 */
const configFake = { get: () => undefined } as unknown as ConfigService;
const usoFake = { registrar: vi.fn() } as unknown as UsoIaService;

/** Prisma que devolve um modelo diferente por conta. */
function prismaComModelos(porConta: Record<string, string>) {
  const upsert = vi.fn(async (args: { where: { contaId: string } }) => ({
    contaId: args.where.contaId,
    modelo: porConta[args.where.contaId] ?? "",
  }));
  return {
    prisma: { configuracaoIa: { upsert } } as unknown as PrismaService,
    upsert,
  };
}

/** `modeloAtual` é privado — é o miolo do que se quer testar. */
const modeloAtual = (s: IaService): Promise<string> =>
  (s as unknown as { modeloAtual: () => Promise<string> }).modeloAtual();

describe("IaService.modeloAtual — cache por conta", () => {
  it("não serve o modelo de uma conta para outra", async () => {
    // A regressão real: o cache era um campo único de instância num provider
    // singleton (IaModule é @Global), mas a consulta filtra por contaIdAtual().
    // A primeira conta a chamar fixava o modelo de TODAS pelos 30s seguintes.
    // Num worker que pula de conta a cada job isso deixa de ser corrida e vira
    // comportamento padrão.
    const { prisma } = prismaComModelos({
      "conta-a": "claude-opus-4-7",
      "conta-b": "claude-haiku-4-5-20251001",
    });
    const service = new IaService(configFake, prisma, usoFake);

    const a = await comConta("conta-a", () => modeloAtual(service));
    const b = await comConta("conta-b", () => modeloAtual(service));

    expect(a).toBe("claude-opus-4-7");
    expect(b).toBe("claude-haiku-4-5-20251001");
  });

  it("cacheia dentro da mesma conta — não consulta o banco a cada chamada", async () => {
    const { prisma, upsert } = prismaComModelos({ "conta-a": "claude-opus-4-7" });
    const service = new IaService(configFake, prisma, usoFake);

    await comConta("conta-a", () => modeloAtual(service));
    await comConta("conta-a", () => modeloAtual(service));
    await comConta("conta-a", () => modeloAtual(service));

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("cada conta tem a sua entrada de cache (uma não invalida a outra)", async () => {
    const { prisma, upsert } = prismaComModelos({
      "conta-a": "claude-opus-4-7",
      "conta-b": "claude-sonnet-4-6",
    });
    const service = new IaService(configFake, prisma, usoFake);

    await comConta("conta-a", () => modeloAtual(service));
    await comConta("conta-b", () => modeloAtual(service));
    // Segunda rodada: as duas já estão em cache.
    const a = await comConta("conta-a", () => modeloAtual(service));
    const b = await comConta("conta-b", () => modeloAtual(service));

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(a).toBe("claude-opus-4-7");
    expect(b).toBe("claude-sonnet-4-6");
  });

  it("conta sem modelo configurado cai no default", async () => {
    const { prisma } = prismaComModelos({});
    const service = new IaService(configFake, prisma, usoFake);

    const m = await comConta("conta-a", () => modeloAtual(service));
    expect(m).toBe("claude-haiku-4-5-20251001");
  });

  it("sem conta no contexto cai no default sem explodir", async () => {
    // É o caso de um worker que esqueceu de abrir comConta. Antes o catch{}
    // engolia o ContaAusenteError calado; agora ainda cai no default, mas
    // avisando — e sem derrubar a chamada.
    const { prisma, upsert } = prismaComModelos({ "conta-a": "claude-opus-4-7" });
    const service = new IaService(configFake, prisma, usoFake);

    const m = await comoSistema(() => modeloAtual(service));

    expect(m).toBe("claude-haiku-4-5-20251001");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("banco fora do ar cai no default em vez de derrubar o OCR", async () => {
    const prisma = {
      configuracaoIa: { upsert: vi.fn().mockRejectedValue(new Error("connection refused")) },
    } as unknown as PrismaService;
    const service = new IaService(configFake, prisma, usoFake);

    const m = await comConta("conta-a", () => modeloAtual(service));
    expect(m).toBe("claude-haiku-4-5-20251001");
  });
});
