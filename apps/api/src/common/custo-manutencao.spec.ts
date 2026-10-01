import { describe, expect, it } from "vitest";
import {
  chaveServico,
  mesesEntre,
  mesSP,
  resumirCustoManutencao,
  type ManutencaoParaCusto,
} from "./custo-manutencao";

let n = 0;
function m(over: Partial<ManutencaoParaCusto> = {}): ManutencaoParaCusto {
  n++;
  return {
    id: `m${n}`,
    veiculoId: "v1",
    tipo: "PREVENTIVA",
    concluidaEm: new Date("2026-09-10T15:00:00Z"),
    valorTotal: 1000,
    descricao: "Troca de óleo",
    fornecedorNome: "Oficina do Zé",
    planoDescricao: null,
    ...over,
  };
}

const veiculos = [
  { id: "v1", placa: "AAA1A11", modelo: "Scania" },
  { id: "v2", placa: "BBB2B22", modelo: null },
];

describe("mesSP / mesesEntre", () => {
  it("dia 1º às 01h UTC ainda é o mês anterior em Brasília", () => {
    expect(mesSP(new Date("2026-10-01T01:00:00Z"))).toBe("2026-09");
  });

  it("lista os meses atravessando a virada do ano", () => {
    expect(mesesEntre("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("chaveServico", () => {
  it("junta o mesmo serviço escrito de jeitos diferentes", () => {
    expect(chaveServico("Troca de Óleo ")).toBe(chaveServico("troca de oleo"));
  });
});

describe("resumirCustoManutencao", () => {
  const base = { veiculos, kmPorVeiculo: new Map<string, number>(), mesDe: "2026-08", mesAte: "2026-09" };

  it("separa programada de quebra, por mês, e mês sem gasto aparece zerado", () => {
    const r = resumirCustoManutencao({
      ...base,
      manutencoes: [
        m({ valorTotal: 600 }),
        m({ tipo: "CORRETIVA", valorTotal: 1500 }),
        m({ tipo: "SINISTRO", valorTotal: 500 }),
        m({ tipo: "PNEU", valorTotal: 400 }),
      ],
    });
    expect(r.porMes).toEqual([
      { mes: "2026-08", programada: 0, quebra: 0, total: 0, consertos: 0 },
      { mes: "2026-09", programada: 1000, quebra: 2000, total: 3000, consertos: 4 },
    ]);
    expect(r.totais.gasto).toBe(3000);
    expect(r.totais.quebraPct).toBe(66.7);
    expect(r.totais.mediaMes).toBe(1500);
  });

  it("conserto sem valor é contado, não vira zero escondido", () => {
    const r = resumirCustoManutencao({ ...base, manutencoes: [m(), m({ valorTotal: null })] });
    expect(r.totais.consertos).toBe(2);
    expect(r.totais.semValor).toBe(1);
    expect(r.totais.gasto).toBe(1000);
  });

  it("caminhão que mais gasta vem primeiro, com R$/km e % de quebra", () => {
    const r = resumirCustoManutencao({
      ...base,
      kmPorVeiculo: new Map([["v1", 10000], ["v2", 2000]]),
      manutencoes: [
        m({ veiculoId: "v1", valorTotal: 1000 }),
        m({ veiculoId: "v2", tipo: "CORRETIVA", valorTotal: 4000 }),
      ],
    });
    expect(r.porCaminhao.map((c) => c.placa)).toEqual(["BBB2B22", "AAA1A11"]);
    expect(r.porCaminhao[0]).toMatchObject({ gasto: 4000, quebraPct: 100, porKm: 2 });
    expect(r.porCaminhao[1]).toMatchObject({ gasto: 1000, quebraPct: 0, porKm: 0.1 });
    expect(r.totais.porKm).toBe(0.42);
  });

  it("serviço: agrupa por escrita normalizada e usa o nome do plano quando houver", () => {
    const r = resumirCustoManutencao({
      ...base,
      manutencoes: [
        m({ descricao: "Troca de óleo" }),
        m({ descricao: "troca de oleo" }),
        m({ descricao: "Freio", tipo: "CORRETIVA", valorTotal: 2500 }),
        m({ descricao: "fiz a revisão", planoDescricao: "Troca de óleo" }),
      ],
    });
    expect(r.porServico[0]).toEqual({ nome: "Troca de óleo", vezes: 3, gasto: 3000 });
    expect(r.porServico[1]).toEqual({ nome: "Freio", vezes: 1, gasto: 2500 });
  });

  it("no empate de escrita, o rótulo é o mais caprichado", () => {
    const r = resumirCustoManutencao({
      ...base,
      manutencoes: [m({ descricao: "troca de oleo" }), m({ descricao: "Troca de óleo" })],
    });
    expect(r.porServico[0]!.nome).toBe("Troca de óleo");
  });

  it("oficina vazia cai em 'Oficina não informada'", () => {
    const r = resumirCustoManutencao({
      ...base,
      manutencoes: [m({ fornecedorNome: null, valorTotal: 700 }), m({ valorTotal: 300 })],
    });
    expect(r.porOficina).toEqual([
      { nome: "Oficina não informada", consertos: 1, gasto: 700 },
      { nome: "Oficina do Zé", consertos: 1, gasto: 300 },
    ]);
  });

  it("sem gasto nenhum, % de quebra e R$/km não existem", () => {
    const r = resumirCustoManutencao({ ...base, manutencoes: [] });
    expect(r.totais.quebraPct).toBeNull();
    expect(r.totais.porKm).toBeNull();
  });
});
