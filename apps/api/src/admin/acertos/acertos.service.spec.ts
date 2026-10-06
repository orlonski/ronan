import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { AcertosService } from "./acertos.service";

// A conferência da tag só existe com o módulo: aqui ela começa desligada (null),
// e os testes dela ligam devolvendo um mapa.
const tagMock = vi.hoisted(() => ({ atual: null as Map<string, unknown> | null }));
vi.mock("../../common/tag-pedagio/tag-das-viagens", () => ({
  tagDasViagens: async () => tagMock.atual,
}));
beforeEach(() => {
  tagMock.atual = null;
});

/**
 * DIA EM QUE A PESSOA ERA EMPREGADA NÃO ENTRA NO ACERTO.
 *
 * ⚠️ O acerto É o documento de pagamento do PARCEIRO autônomo. O filtro de
 * regime existia só nos dias de obra; a busca de viagens não olhava regime
 * nenhum. Então quem fosse registrado em carteira e continuasse lançando
 * viagem seguia gerando item por produção — pagamento por fora a empregado
 * (art. 457 §1º da CLT), com carimbo da nossa régua.
 *
 * E a pergunta é por DATA, não "o que ele é hoje": quem foi parceiro até março
 * e foi registrado em abril tem direito ao acerto de março.
 */

// Decimal do Prisma aceita string; objeto com toString() não passa no construtor.
const dec = (v: string) => v as never;

function servico(estado: {
  /** Períodos de EMPREGO desta pessoa: [início, fim ou null]. */
  emprego?: { iniciouEm: Date; encerradoEm: Date | null }[];
  viagens?: { id: string; data: Date }[];
  /** Linhas de acerto que já apontam pras viagens (de outros acertos). */
  itensExistentes?: Record<string, unknown>[];
  /** Gastos de viagem já APROVADOS que a busca devolveria. */
  despesas?: { id: string; data: Date; valorAprovado: string }[];
  /** Pedágio que o motorista lançou em cada viagem (valorPedagioTotal). */
  pedagioLancado?: Record<string, string>;
  /** Decisões da conferência da tag. */
  decisoesTag?: Record<string, unknown>[];
  /** Reembolsos de pedágio já em acerto FECHADO/PAGO (consulta do ajuste da tag). */
  pedagiosFechados?: Record<string, unknown>[];
}) {
  const criados: Record<string, unknown>[] = [];
  const apagados: unknown[] = [];
  let abastWhere: Record<string, unknown> | null = null;
  let vezesAcerto = 0;

  const viagem = (v: { id: string; data: Date }) => ({
    ...v,
    ticket: null,
    km: dec("100"),
    toneladas: dec("30"),
    valorPedagioTotal: dec(estado.pedagioLancado?.[v.id] ?? "0"),
    veiculoId: "cam1",
    tipoServico: { medicao: "PESO" },
    cliente: { nome: "Pedreira" },
    valor: { valorFrete: dec("1000") },
    pedagios: [],
  });

  const prisma = {
    motorista: {
      findUnique: async () => ({
        id: "mot1",
        nome: "Joao",
        cpf: "11122233344",
        // Régua simples: R$ 150 por viagem. Cada viagem que passar pelo filtro
        // vira uma linha, então contar linhas é contar viagens aceitas.
        tipoRemuneracao: "VALOR_POR_VIAGEM",
        valorPorViagem: dec("150"),
        modalidade: null,
      }),
    },
    acertoMotorista: {
      findFirst: async () => {
        // 1ª chamada: "já existe acerto deste período?" → não.
        // 2ª: o `detalhe` do fim, que precisa achar o que acabou de criar.
        vezesAcerto += 1;
        return vezesAcerto === 1 ? null : { id: "ac1", itens: [], motorista: {} };
      },
      create: async () => ({ id: "ac1" }),
      update: async () => ({ id: "ac1" }),
    },
    regimeVigente: { findMany: async () => estado.emprego ?? [] },
    viagem: { findMany: async () => (estado.viagens ?? []).map(viagem) },
    abastecimento: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        abastWhere = where;
        return [];
      },
    },
    pedagio: { findMany: async () => [] },
    despesa: {
      findMany: async () =>
        (estado.despesas ?? []).map((d) => ({ ...d, tipoNome: "Alimentação", descricao: null })),
    },
    registroPresenca: { findMany: async () => [] },
    itemAcerto: {
      deleteMany: async ({ where }: { where: unknown }) => {
        apagados.push(where);
        return { count: 0 };
      },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        criados.push(...data);
        return { count: data.length };
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        where.tipo === "REEMBOLSO_PEDAGIO" && where.acerto
          ? (estado.pedagiosFechados ?? [])
          : (estado.itensExistentes ?? []),
    },
    decisaoPedagioTag: { findMany: async () => estado.decisoesTag ?? [] },
  } as Record<string, unknown>;
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);

  const auditoria = { log: async () => {} };
  return {
    s: new AcertosService(prisma as never, auditoria as never),
    /** Ids de viagem que viraram linha de acerto. */
    viagensPagas: () => criados.map((i) => i.viagemId).filter(Boolean),
    criados,
    apagados,
    abastWhere: () => abastWhere,
    /** Ids de gasto de viagem que viraram linha "Reembolso de gastos". */
    despesasPagas: () => criados.map((i) => i.despesaId).filter(Boolean),
  };
}

const periodo = { motoristaId: "mot1", periodoInicio: "2026-03-01", periodoFim: "2026-03-31" };
const em = (d: string) => new Date(`${d}T00:00:00.000Z`);

describe("acerto não alcança dia de vínculo de emprego", () => {
  it("sem vínculo nenhum, as viagens do período entram", async () => {
    const { s, viagensPagas } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }, { id: "v2", data: em("2026-03-20") }],
    });
    await s.gerar(periodo as never, "user1");
    expect(viagensPagas()).toEqual(["v1", "v2"]);
  });

  it("registrado no meio do mês: entra o que é de antes, sai o que é de depois", async () => {
    const { s, viagensPagas } = servico({
      emprego: [{ iniciouEm: em("2026-03-16"), encerradoEm: null }],
      viagens: [{ id: "v1", data: em("2026-03-10") }, { id: "v2", data: em("2026-03-20") }],
    });
    await s.gerar(periodo as never, "user1");
    expect(viagensPagas()).toEqual(["v1"]);
  });

  it("vínculo que já terminou não alcança viagem posterior a ele", async () => {
    // Quem foi empregado até fevereiro e voltou a ser parceiro em março
    // recebe por março inteiro.
    const { s, viagensPagas } = servico({
      emprego: [{ iniciouEm: em("2025-01-01"), encerradoEm: em("2026-02-28") }],
      viagens: [{ id: "v1", data: em("2026-03-10") }],
    });
    await s.gerar(periodo as never, "user1");
    expect(viagensPagas()).toEqual(["v1"]);
  });

  it("período INTEIRO dentro do vínculo é recusado, não vira acerto vazio", async () => {
    // Acerto zerado o operador leria como "ele não rodou". O que ele recebe
    // vai por folha, e isso a mensagem precisa dizer.
    const { s } = servico({
      emprego: [{ iniciouEm: em("2026-01-01"), encerradoEm: null }],
      viagens: [{ id: "v1", data: em("2026-03-10") }],
    });
    await expect(s.gerar(periodo as never, "user1")).rejects.toThrow(/folha de pagamento/i);
  });
});

describe("seleção nova do acerto (Onda 0c)", () => {
  const acertoDe = (id: string, status: string) => ({
    id,
    status,
    periodoInicio: em("2026-03-01"),
    periodoFim: em("2026-03-15"),
  });

  it("viagem que já está em acerto FECHADO não entra de novo", async () => {
    const { s, viagensPagas } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }, { id: "v2", data: em("2026-03-20") }],
      itensExistentes: [
        {
          id: "x1",
          tipo: "FRETE",
          viagemId: "v1",
          pedagioId: null,
          abastecimentoId: null,
          automatico: true,
          puxadoDe: null,
          acerto: acertoDe("fechado", "FECHADO"),
        },
      ],
    });
    await s.gerar(periodo as never, "user1");
    expect(viagensPagas()).toEqual(["v2"]);
  });

  it("viagem de outro acerto ABERTO vem pra cá com aviso e sai de lá", async () => {
    const { s, criados, apagados } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }],
      itensExistentes: [
        {
          id: "x1",
          tipo: "FRETE",
          viagemId: "v1",
          pedagioId: null,
          abastecimentoId: null,
          automatico: true,
          puxadoDe: null,
          acerto: acertoDe("esquecido", "ABERTO"),
        },
      ],
    });
    const r = await s.gerar(periodo as never, "user1");
    expect(criados[0].puxadoDe).toBe("Este item saiu do acerto de 01/03 a 15/03.");
    expect(apagados[0]).toMatchObject({ id: { in: ["x1"] }, acerto: { status: "ABERTO" } });
    expect(r.puxados).toBe(1);
  });

  it("abastecimento busca pelo dia de São Paulo (03:00Z), não pela meia-noite UTC", async () => {
    const { s, abastWhere } = servico({ viagens: [] });
    await s.gerar(periodo as never, "user1");
    const data = (abastWhere() as { data: { gte: Date; lt: Date } }).data;
    expect(data.gte.toISOString()).toBe("2026-03-01T03:00:00.000Z");
    expect(data.lt.toISOString()).toBe("2026-04-01T03:00:00.000Z");
  });
});

describe("gasto de viagem no acerto (B10: dia de emprego CLT não entra)", () => {
  it("gasto aprovado do período vira REEMBOLSO_DESPESA, com ou sem viagem", async () => {
    const { s, despesasPagas } = servico({
      despesas: [{ id: "d1", data: new Date("2026-03-10T15:00:00Z"), valorAprovado: "38.00" }],
    });
    await s.gerar(periodo as never, "user1");
    expect(despesasPagas()).toEqual(["d1"]);
  });

  it("gasto de dia em que ele era empregado registrado NUNCA entra no acerto", async () => {
    const { s, despesasPagas } = servico({
      emprego: [{ iniciouEm: em("2026-03-16"), encerradoEm: null }],
      despesas: [
        { id: "antes", data: new Date("2026-03-10T15:00:00Z"), valorAprovado: "38.00" },
        { id: "depois", data: new Date("2026-03-20T15:00:00Z"), valorAprovado: "45.00" },
      ],
    });
    await s.gerar(periodo as never, "user1");
    expect(despesasPagas()).toEqual(["antes"]);
  });

  it("o dia que conta é o de São Paulo: 23h do dia 15 (SP) ainda é antes do vínculo", async () => {
    const { s, despesasPagas } = servico({
      emprego: [{ iniciouEm: em("2026-03-16"), encerradoEm: null }],
      // 02:00 UTC do dia 16 = 23:00 do dia 15 em São Paulo.
      despesas: [{ id: "noite", data: new Date("2026-03-16T02:00:00Z"), valorAprovado: "30.00" }],
    });
    await s.gerar(periodo as never, "user1");
    expect(despesasPagas()).toEqual(["noite"]);
  });
});

describe("conferência da tag no acerto (Onda 2)", () => {
  const decisao = (valorReembolso: string, valorLancado = "120.00") => ({
    id: "dec1",
    viagemId: "v1",
    valorLancado: new Prisma.Decimal(valorLancado),
    valorTag: new Prisma.Decimal("78"),
    valorReembolso: new Prisma.Decimal(valorReembolso),
    motivo: null,
    itensAcerto: [] as { acertoId: string; acerto: { status: string } }[],
  });
  // A tag pagou R$ 78 na ida de v1 e de v9 — os números sobre os quais a decisão foi tomada.
  const ligado = () => {
    const pagou = { temTag: true, faturaCobreODia: true, cobertura: { tag: "78", vale: "0", trechos: 1 } };
    tagMock.atual = new Map([
      ["v1", pagou],
      ["v9", pagou],
    ]);
  };
  const pedagioDe = (criados: Record<string, unknown>[]) =>
    criados.filter((i) => i.tipo === "REEMBOLSO_PEDAGIO").map((i) => i.valor);

  it("sem o módulo, o reembolso é o lançado, como sempre foi", async () => {
    const { s, criados } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }],
      pedagioLancado: { v1: "120" },
      decisoesTag: [decisao("42")],
    });
    await s.gerar(periodo as never, "user1");
    expect(pedagioDe(criados)).toEqual(["120.00"]);
  });

  it("com decisão, o reembolso é o decidido: só o que a tag não pagou", async () => {
    ligado();
    const { s, criados } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }],
      pedagioLancado: { v1: "120" },
      decisoesTag: [decisao("42")],
    });
    await s.gerar(periodo as never, "user1");
    expect(pedagioDe(criados)).toEqual(["42.00"]);
  });

  it("a tag pagou tudo: o reembolso sai do acerto", async () => {
    ligado();
    const { s, criados } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }],
      pedagioLancado: { v1: "120" },
      decisoesTag: [decisao("0")],
    });
    await s.gerar(periodo as never, "user1");
    expect(pedagioDe(criados)).toEqual([]);
  });

  it("motorista mudou o lançado depois da decisão: volta a valer o lançado", async () => {
    ligado();
    const { s, criados } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }],
      pedagioLancado: { v1: "150" },
      decisoesTag: [decisao("42", "120.00")],
    });
    await s.gerar(periodo as never, "user1");
    expect(pedagioDe(criados)).toEqual(["150.00"]);
  });

  it("já reembolsado em acerto fechado: a decisão vira ajuste neste, sem reabrir o outro", async () => {
    ligado();
    const { s, criados } = servico({
      viagens: [],
      pedagiosFechados: [
        {
          viagemId: "v9",
          valor: new Prisma.Decimal("120"),
          acerto: { periodoInicio: em("2026-02-01"), periodoFim: em("2026-02-28") },
          viagem: {
            id: "v9",
            data: em("2026-02-10"),
            veiculoId: "cam1",
            valorPedagioTotal: new Prisma.Decimal("120"),
            pedagios: [],
            decisaoPedagioTag: [{ ...decisao("42"), viagemId: "v9" }],
          },
        },
      ],
    });
    await s.gerar(periodo as never, "user1");
    const ajuste = criados.find((i) => i.tipo === "AJUSTE");
    expect(ajuste).toMatchObject({ viagemId: "v9", decisaoPedagioTagId: "dec1", valor: "-78.00" });
    expect(String(ajuste?.descricao)).toContain("acerto de 01/02 a 28/02");
    expect(ajuste?.motivo).toBeTruthy();
  });

  it("a ligação da tag foi desfeita depois da decisão: volta a valer o lançado", async () => {
    tagMock.atual = new Map([["v1", { temTag: true, faturaCobreODia: true, cobertura: null }]]);
    const { s, criados } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }],
      pedagioLancado: { v1: "120" },
      decisoesTag: [decisao("42")],
    });
    await s.gerar(periodo as never, "user1");
    expect(pedagioDe(criados)).toEqual(["120.00"]);
  });

  it("acerto reaberto cuja decisão já virou ajuste em outro: não desconta de novo aqui", async () => {
    ligado();
    const { s, criados } = servico({
      viagens: [{ id: "v1", data: em("2026-03-10") }],
      pedagioLancado: { v1: "120" },
      decisoesTag: [{ ...decisao("42"), itensAcerto: [{ acertoId: "acB", acerto: { status: "FECHADO" } }] }],
    });
    await s.gerar(periodo as never, "user1");
    expect(pedagioDe(criados)).toEqual(["120.00"]);
  });

  it("ajuste que já está em outro acerto aberto fica lá — não muda de acerto a cada geração", async () => {
    ligado();
    const { s, criados } = servico({
      viagens: [],
      pedagiosFechados: [
        {
          viagemId: "v9",
          valor: new Prisma.Decimal("120"),
          acerto: { periodoInicio: em("2026-02-01"), periodoFim: em("2026-02-28") },
          viagem: {
            id: "v9",
            data: em("2026-02-10"),
            veiculoId: "cam1",
            valorPedagioTotal: new Prisma.Decimal("120"),
            pedagios: [],
            decisaoPedagioTag: [
              { ...decisao("42"), viagemId: "v9", itensAcerto: [{ acertoId: "acOutro", acerto: { status: "ABERTO" } }] },
            ],
          },
        },
      ],
    });
    await s.gerar(periodo as never, "user1");
    expect(criados.find((i) => i.tipo === "AJUSTE")).toBeUndefined();
  });
});
