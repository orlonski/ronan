import { describe, expect, it } from "vitest";
import type { RegraRemuneracao } from "./acerto-motorista";
import {
  calcularLucroVeiculo,
  custoFixoNoPeriodo,
  type EntradaLucroVeiculo,
  type ViagemParaLucro,
} from "./lucro-veiculo";

function regra(over: Partial<RegraRemuneracao> = {}): RegraRemuneracao {
  return {
    tipo: "VALOR_POR_VIAGEM",
    percentualFrete: null,
    valorPorViagem: 100,
    valorPorTonelada: null,
    valorPorKm: null,
    reembolsaPedagio: true,
    reembolsaAbastecimento: true,
    ...over,
  };
}

function viagem(over: Partial<ViagemParaLucro> = {}): ViagemParaLucro {
  return {
    id: "v1",
    data: new Date("2026-06-10"),
    ticket: "12345",
    km: 50,
    toneladas: 30,
    valorPedagioTotal: 0,
    valorFrete: 600,
    pedagios: [],
    valorTotal: 600,
    freteAcertado: null,
    regra: regra(),
    ...over,
  };
}

function entrada(over: Partial<EntradaLucroVeiculo> = {}): EntradaLucroVeiculo {
  return {
    de: "2026-06-01",
    ate: "2026-06-30",
    viagens: [],
    abastecimentos: [],
    pedagiosAvulsos: [],
    manutencoes: [],
    multas: [],
    outrasContas: [],
    custosFixos: [],
    precoMedioLitro: {},
    ...over,
  };
}

describe("calcularLucroVeiculo", () => {
  it("faturou menos o motorista é o que sobrou", () => {
    const r = calcularLucroVeiculo(entrada({ viagens: [viagem(), viagem({ id: "v2" })] }));
    expect(r.viagens).toBe(2);
    expect(r.faturou).toBe("1200.00");
    expect(r.custos.motorista).toBe("200.00");
    expect(r.gastou).toBe("200.00");
    expect(r.sobrou).toBe("1000.00");
    expect(r.margem).toBe(83.3);
  });

  it("viagem sem preço não vira R$ 0 calado: é contada", () => {
    const r = calcularLucroVeiculo(
      entrada({ viagens: [viagem(), viagem({ id: "v2", valorTotal: null, valorFrete: null })] }),
    );
    expect(r.faturou).toBe("600.00");
    expect(r.avisos.viagensSemPreco).toBe(1);
  });

  it("percentual de viagem sem preço é avisado só como falta de preço", () => {
    const r = calcularLucroVeiculo(
      entrada({
        viagens: [
          viagem({
            valorTotal: null,
            valorFrete: null,
            regra: regra({ tipo: "PERCENTUAL_FRETE", percentualFrete: 12 }),
          }),
        ],
      }),
    );
    expect(r.avisos.viagensSemPreco).toBe(1);
    expect(r.avisos.viagensSemCustoMotorista).toBe(0);
  });

  it("o valor do acerto vence a régua de hoje", () => {
    const r = calcularLucroVeiculo(
      entrada({ viagens: [viagem({ freteAcertado: 130 })] }),
    );
    expect(r.custos.motorista).toBe("130.00");
  });

  it("régua que não cobre a viagem é avisada, não zerada em silêncio", () => {
    const r = calcularLucroVeiculo(
      entrada({ viagens: [viagem({ regra: regra({ tipo: "SEM_REMUNERACAO" }) })] }),
    );
    expect(r.custos.motorista).toBe("0.00");
    expect(r.avisos.viagensSemCustoMotorista).toBe(1);
  });

  it("dia de empregado não tem custo por viagem (é salário) e o pedágio é da empresa", () => {
    const r = calcularLucroVeiculo(
      entrada({ viagens: [viagem({ regra: null, valorPedagioTotal: 40 })] }),
    );
    expect(r.custos.motorista).toBe("0.00");
    expect(r.custos.pedagio).toBe("40.00");
    expect(r.avisos.viagensEmpregado).toBe(1);
    expect(r.avisos.viagensSemCustoMotorista).toBe(0);
  });

  it("pedágio com as duas fontes preenchidas conta uma vez só", () => {
    const r = calcularLucroVeiculo(
      entrada({
        viagens: [
          viagem({
            valorPedagioTotal: 50,
            pedagios: [{ id: "p1", valor: 50 }],
          }),
        ],
      }),
    );
    expect(r.custos.pedagio).toBe("50.00");
  });

  it("pedágio que a modalidade não devolve fica fora da conta, mas aparece", () => {
    const r = calcularLucroVeiculo(
      entrada({
        viagens: [viagem({ valorPedagioTotal: 50, regra: regra({ reembolsaPedagio: false }) })],
        pedagiosAvulsos: [{ id: "p9", valor: 20, empresaPaga: false }],
      }),
    );
    expect(r.custos.pedagio).toBe("0.00");
    expect(r.foraDaConta.pedagio).toBe("70.00");
  });

  it("combustível: devolvido entra, pago pelo parceiro fica fora", () => {
    const r = calcularLucroVeiculo(
      entrada({
        abastecimentos: [
          { id: "a1", tipo: "DIESEL_S10", litros: 100, valorTotal: 600, emComboio: false, empresaPaga: true },
          { id: "a2", tipo: "DIESEL_S10", litros: 100, valorTotal: 610, emComboio: false, empresaPaga: false },
        ],
      }),
    );
    expect(r.custos.combustivel).toBe("600.00");
    expect(r.foraDaConta.combustivel).toBe("610.00");
  });

  it("comboio sem valor usa o preço médio do litro e é marcado como estimado", () => {
    const r = calcularLucroVeiculo(
      entrada({
        abastecimentos: [
          // empresaPaga=false: comboio é da empresa mesmo assim.
          { id: "a1", tipo: "DIESEL_S10", litros: 200, valorTotal: null, emComboio: true, empresaPaga: false },
        ],
        precoMedioLitro: { DIESEL_S10: "6.10" },
      }),
    );
    expect(r.custos.combustivel).toBe("1220.00");
    expect(r.avisos.abastecimentosEstimados).toBe(1);
  });

  it("comboio sem valor e sem preço médio não entra, e é avisado", () => {
    const r = calcularLucroVeiculo(
      entrada({
        abastecimentos: [
          { id: "a1", tipo: "DIESEL_S10", litros: 200, valorTotal: null, emComboio: true, empresaPaga: false },
        ],
      }),
    );
    expect(r.custos.combustivel).toBe("0.00");
    expect(r.avisos.abastecimentosSemPreco).toBe(1);
  });

  it("manutenção sem valor é contada à parte", () => {
    const d = new Date("2026-06-15");
    const r = calcularLucroVeiculo(
      entrada({
        manutencoes: [
          { id: "m1", data: d, descricao: "Troca de óleo", valor: 900 },
          { id: "m2", data: d, descricao: "Freio", valor: null },
        ],
        multas: [{ id: "x1", data: d, descricao: "Velocidade", valor: 195.23 }],
        outrasContas: [{ id: "t1", data: d, descricao: "Lavagem", valor: 80 }],
      }),
    );
    expect(r.custos.manutencao).toBe("900.00");
    expect(r.custos.multas).toBe("195.23");
    expect(r.custos.outrasContas).toBe("80.00");
    expect(r.avisos.manutencoesSemValor).toBe(1);
    expect(r.detalhe.manutencoes[1]!.valor).toBeNull();
  });

  it("caminhão parado: sem viagem, custo fixo vira prejuízo e a margem não existe", () => {
    const r = calcularLucroVeiculo(
      entrada({
        custosFixos: [
          { id: "c1", tipo: "SEGURO", valorMensal: 900, vigenciaDe: new Date("2026-01-01"), vigenciaAte: null },
        ],
      }),
    );
    expect(r.custos.custosFixos).toBe("900.00");
    expect(r.sobrou).toBe("-900.00");
    expect(r.margem).toBeNull();
    expect(r.detalhe.custosFixos).toHaveLength(1);
  });
});

describe("custoFixoNoPeriodo", () => {
  const custo = (de: string, ate: string | null = null) => ({
    id: "c",
    tipo: "IPVA",
    valorMensal: 3000,
    vigenciaDe: new Date(`${de}T00:00:00Z`),
    vigenciaAte: ate ? new Date(`${ate}T00:00:00Z`) : null,
  });

  it("mês cheio dá o mensal, em mês de 31 e de 28 dias", () => {
    expect(custoFixoNoPeriodo(custo("2026-01-01"), "2026-07-01", "2026-07-31").toFixed(2)).toBe("3000.00");
    expect(custoFixoNoPeriodo(custo("2026-01-01"), "2026-02-01", "2026-02-28").toFixed(2)).toBe("3000.00");
  });

  it("vigência que começa no meio do mês cobra só os dias dela", () => {
    // 16 a 30 de junho = 15 de 30 dias.
    expect(custoFixoNoPeriodo(custo("2026-06-16"), "2026-06-01", "2026-06-30").toFixed(2)).toBe("1500.00");
  });

  it("vigência encerrada antes do período não cobra nada", () => {
    expect(custoFixoNoPeriodo(custo("2026-01-01", "2026-05-31"), "2026-06-01", "2026-06-30").toFixed(2)).toBe("0.00");
  });

  it("período que atravessa dois meses soma a fração de cada um", () => {
    // 16-30/06 (15/30) + 01-15/07 (15/31)
    const v = custoFixoNoPeriodo(custo("2026-01-01"), "2026-06-16", "2026-07-15");
    expect(v.toFixed(2)).toBe((1500 + (3000 * 15) / 31).toFixed(2));
  });
});
