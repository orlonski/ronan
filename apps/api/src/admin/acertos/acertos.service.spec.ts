import { describe, expect, it } from "vitest";
import { AcertosService } from "./acertos.service";

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
  /** Gastos de viagem já APROVADOS que a busca devolveria. */
  despesas?: { id: string; data: Date; valorAprovado: string }[];
}) {
  const criados: Record<string, unknown>[] = [];
  let vezesAcerto = 0;

  const viagem = (v: { id: string; data: Date }) => ({
    ...v,
    ticket: null,
    km: dec("100"),
    toneladas: dec("30"),
    valorPedagioTotal: dec("0"),
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
    abastecimento: { findMany: async () => [] },
    pedagio: { findMany: async () => [] },
    despesa: {
      findMany: async () =>
        (estado.despesas ?? []).map((d) => ({ ...d, tipoNome: "Alimentação", descricao: null })),
    },
    registroPresenca: { findMany: async () => [] },
    itemAcerto: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        criados.push(...data);
        return { count: data.length };
      },
      findMany: async () => [],
    },
  } as Record<string, unknown>;
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);

  const auditoria = { log: async () => {} };
  return {
    s: new AcertosService(prisma as never, auditoria as never),
    /** Ids de viagem que viraram linha de acerto. */
    viagensPagas: () => criados.map((i) => i.viagemId).filter(Boolean),
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
