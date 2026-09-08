import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LancamentosPessoaisService } from "./lancamentos-pessoais.service";
import type { PrismaService } from "../prisma/prisma.service";

const EU = "identidade-do-motorista";
const OUTRO = "identidade-de-outra-pessoa";

function linha(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "l1",
    identidadeId: EU,
    clientId: "c1",
    tipo: "OUTRO_GASTO",
    data: new Date("2026-09-10T00:00:00.000Z"),
    valor: new Prisma.Decimal("10.00"),
    litros: null,
    odometro: null,
    descricao: null,
    criadoEm: new Date("2026-09-10T12:00:00.000Z"),
    ...over,
  };
}

/** Prisma de mentira que só guarda o que foi pedido. */
function fakePrisma(itens: ReturnType<typeof linha>[] = []) {
  const chamadas: Record<string, unknown>[] = [];
  const prisma = {
    lancamentoPessoal: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        chamadas.push(args);
        return itens;
      }),
      findUnique: vi.fn(async (args: { where: { identidadeId_clientId: { identidadeId: string; clientId: string } } }) => {
        chamadas.push(args);
        const { identidadeId, clientId } = args.where.identidadeId_clientId;
        return itens.find((i) => i.identidadeId === identidadeId && i.clientId === clientId) ?? null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        chamadas.push(args);
        return linha(args.data);
      }),
      // Sem viagem nenhuma por padrão — os testes de viagem sobrescrevem.
      deleteMany: vi.fn(async (args: { where: { id: string; identidadeId: string } }) => {
        chamadas.push(args);
        const alvo = itens.filter(
          (i) => i.id === args.where.id && i.identidadeId === args.where.identidadeId,
        );
        return { count: alvo.length };
      }),
    },
    viagemPessoal: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaService;
  return { prisma, chamadas };
}

describe("caderninho do motorista", () => {
  it("toda leitura leva a pessoa no filtro — a trava de conta não protege esta tabela", async () => {
    const { prisma, chamadas } = fakePrisma();
    await new LancamentosPessoaisService(prisma).listar(EU, "2026-09");
    const where = (chamadas[0] as { where: Record<string, unknown> }).where;
    expect(where.identidadeId).toBe(EU);
  });

  it("o mês vai do dia 1º ao 1º do mês seguinte, sem deslocar a borda", async () => {
    const { prisma, chamadas } = fakePrisma();
    await new LancamentosPessoaisService(prisma).listar(EU, "2026-12");
    const where = (chamadas[0] as { where: { data: { gte: Date; lt: Date } } }).where;
    // Dezembro precisa virar pra janeiro do ano seguinte, não pro mês 13.
    expect(where.data.gte.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(where.data.lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("soma o que entrou, o que saiu e o que sobrou", async () => {
    const { prisma } = fakePrisma([
      linha({ id: "a", tipo: "GANHO", valor: new Prisma.Decimal("1500.00") }),
      linha({ id: "b", tipo: "PEDAGIO", valor: new Prisma.Decimal("42.50") }),
      linha({
        id: "c",
        tipo: "ABASTECIMENTO",
        valor: new Prisma.Decimal("600.00"),
        litros: new Prisma.Decimal("100.00"),
      }),
    ]);
    const r = await new LancamentosPessoaisService(prisma).resumo(EU, "2026-09");
    expect(r.ganhos).toBe(1500);
    expect(r.gastos).toBe(642.5);
    expect(r.saldo).toBe(857.5);
    expect(r.precoMedioLitro).toBe(6);
  });

  it("sem litro informado não inventa preço médio", async () => {
    const { prisma } = fakePrisma([
      linha({ tipo: "ABASTECIMENTO", valor: new Prisma.Decimal("300.00"), litros: null }),
    ]);
    const r = await new LancamentosPessoaisService(prisma).resumo(EU, "2026-09");
    expect(r.precoMedioLitro).toBeNull();
    expect(r.gastos).toBe(300);
  });

  it("dinheiro não vaza em dízima na soma", async () => {
    const { prisma } = fakePrisma([
      linha({ id: "a", valor: new Prisma.Decimal("0.10") }),
      linha({ id: "b", valor: new Prisma.Decimal("0.20") }),
    ]);
    const r = await new LancamentosPessoaisService(prisma).resumo(EU, "2026-09");
    expect(r.gastos).toBe(0.3);
  });

  it("reenviar o mesmo lançamento não cria outro — o outbox reenvia sozinho", async () => {
    const { prisma } = fakePrisma([linha({ clientId: "abc12345" })]);
    const service = new LancamentosPessoaisService(prisma);
    const r = await service.criar(EU, {
      clientId: "abc12345",
      tipo: "PEDAGIO",
      data: "2026-09-10",
      valor: 99,
    });
    expect(r.id).toBe("l1");
    expect(prisma.lancamentoPessoal.create).not.toHaveBeenCalled();
  });

  it("clientId igual ao de OUTRA pessoa é lançamento novo, não conflito", async () => {
    const { prisma } = fakePrisma([linha({ identidadeId: OUTRO, clientId: "abc12345" })]);
    const service = new LancamentosPessoaisService(prisma);
    await service.criar(EU, {
      clientId: "abc12345",
      tipo: "PEDAGIO",
      data: "2026-09-10",
      valor: 99,
    });
    expect(prisma.lancamentoPessoal.create).toHaveBeenCalled();
  });

  it("não apaga o lançamento de outra pessoa", async () => {
    const { prisma } = fakePrisma([linha({ id: "alheio", identidadeId: OUTRO })]);
    await expect(new LancamentosPessoaisService(prisma).apagar(EU, "alheio")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("o que sai pra fora não leva o id da pessoa", async () => {
    const { prisma } = fakePrisma([linha()]);
    const [item] = await new LancamentosPessoaisService(prisma).listar(EU, "2026-09");
    expect(item).not.toHaveProperty("identidadeId");
    expect(item!.data).toBe("2026-09-10");
    expect(item!.valor).toBe(10);
  });
});

describe("as viagens dele", () => {
  it("o frete das viagens entra no ganho do mês, junto com os avulsos", async () => {
    const { prisma } = fakePrisma([linha({ tipo: "GANHO", valor: new Prisma.Decimal("500.00") })]);
    (prisma as unknown as { viagemPessoal: unknown }).viagemPessoal = {
      findMany: async () => [
        {
          id: "v1",
          clientId: "cv1",
          data: new Date("2026-09-05T00:00:00.000Z"),
          origem: "Curitiba",
          destino: "Joinville",
          carga: null,
          km: new Prisma.Decimal("130.00"),
          peso: null,
          valorRecebido: new Prisma.Decimal("1300.00"),
          observacao: null,
          criadoEm: new Date(),
        },
      ],
    };
    const r = await new LancamentosPessoaisService(prisma).resumo(EU, "2026-09");
    expect(r.ganhos).toBe(1800); // 500 avulso + 1300 de frete
    expect(r.viagens).toBe(1);
    expect(r.km).toBe(130);
    // 1800 / 130 km
    expect(r.ganhoPorKm).toBe(13.85);
  });

  it("sem km informado não inventa R$ por km", async () => {
    const { prisma } = fakePrisma([]);
    (prisma as unknown as { viagemPessoal: unknown }).viagemPessoal = {
      findMany: async () => [
        {
          id: "v1",
          clientId: "cv1",
          data: new Date("2026-09-05T00:00:00.000Z"),
          origem: "A",
          destino: "B",
          carga: null,
          km: null,
          peso: null,
          valorRecebido: new Prisma.Decimal("900.00"),
          observacao: null,
          criadoEm: new Date(),
        },
      ],
    };
    const r = await new LancamentosPessoaisService(prisma).resumo(EU, "2026-09");
    expect(r.ganhoPorKm).toBeNull();
    expect(r.ganhos).toBe(900);
  });
});
