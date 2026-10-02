import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { RegraRemuneracao } from "./acerto-motorista";
import { calcularLucroVeiculo, type EntradaLucroVeiculo } from "./lucro-veiculo";
import {
  calcularResultadoObras,
  ratearCentavos,
  type CaminhaoParaResultado,
  type ObraDaViagem,
  type ViagemParaResultado,
} from "./resultado-obra";

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

const OBRA_A: ObraDaViagem = { clienteId: "obra-a", obra: "Obra A", empresaId: "emp-1", empresa: "Construtora 1" };
const OBRA_B: ObraDaViagem = { clienteId: "obra-b", obra: "Obra B", empresaId: "emp-2", empresa: "Construtora 2" };

function viagem(over: Partial<ViagemParaResultado> = {}): ViagemParaResultado {
  return {
    id: "v1",
    data: new Date("2026-06-10"),
    ticket: "1",
    km: 50,
    toneladas: 30,
    valorPedagioTotal: 0,
    valorFrete: 600,
    pedagios: [],
    valorTotal: 600,
    freteAcertado: null,
    regra: regra(),
    obra: OBRA_A,
    pedagioCobrado: 0,
    estadia: 0,
    ...over,
  };
}

function caminhao(
  placa: string,
  over: Partial<CaminhaoParaResultado["entrada"]> = {},
): CaminhaoParaResultado {
  return {
    veiculoId: placa,
    placa,
    entrada: {
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
    },
  };
}

const n = (s: string) => Number(s);

describe("ratearCentavos", () => {
  it("a soma das partes é exatamente o total", () => {
    const partes = ratearCentavos("100.00", [1, 1, 1]);
    expect(partes.map((p) => p.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
    expect(partes.reduce((a, p) => a.add(p), new Prisma.Decimal(0)).toFixed(2)).toBe("100.00");
  });

  it("proporcional ao peso", () => {
    expect(ratearCentavos("300.00", [100, 200]).map((p) => p.toFixed(2))).toEqual(["100.00", "200.00"]);
  });

  it("pesos todos zero dividem igual (o custo não pode sumir)", () => {
    expect(ratearCentavos("10.00", [0, 0]).map((p) => p.toFixed(2))).toEqual(["5.00", "5.00"]);
  });
});

describe("calcularResultadoObras", () => {
  it("motorista é direto; diesel e custo fixo vão pelo km", () => {
    const r = calcularResultadoObras([
      caminhao("AAA1A11", {
        viagens: [
          viagem({ id: "v1", km: 100, obra: OBRA_A, valorTotal: 1000 }),
          viagem({ id: "v2", km: 300, obra: OBRA_B, valorTotal: 2000 }),
        ],
        abastecimentos: [
          { id: "a1", tipo: "DIESEL", litros: 200, valorTotal: 1200, emComboio: false, empresaPaga: true },
        ],
        // Junho: 30 dias, mês cheio = 3000.
        custosFixos: [
          { id: "c1", tipo: "SEGURO", valorMensal: 3000, vigenciaDe: new Date("2026-01-01"), vigenciaAte: null },
        ],
      }),
    ]);
    const a = r.obras.find((o) => o.chave === "obra-a")!;
    const b = r.obras.find((o) => o.chave === "obra-b")!;
    expect(a.custos.motorista).toBe("100.00");
    expect(b.custos.motorista).toBe("100.00");
    expect(a.custos.combustivel).toBe("300.00");
    expect(b.custos.combustivel).toBe("900.00");
    expect(a.custos.custosFixos).toBe("750.00");
    expect(b.custos.custosFixos).toBe("2250.00");
    expect(a.custo).toBe("1150.00");
    expect(a.margem).toBe("-150.00");
    expect(a.margemPct).toBe(-15);
    expect(b.margem).toBe("-1250.00");
    // Pior margem primeiro.
    expect(r.obras[0]!.chave).toBe("obra-b");
  });

  it("soma das obras + sem obra + parado fecha com o lucro por caminhão", () => {
    const c1 = caminhao("AAA1A11", {
      viagens: [
        viagem({ id: "v1", km: 33, obra: OBRA_A, valorTotal: 1000.01, valorFrete: 1000.01 }),
        viagem({ id: "v2", km: 77, obra: OBRA_B, valorTotal: 777.77, valorFrete: 777.77, valorPedagioTotal: 45.3 }),
        viagem({ id: "v3", km: 11, obra: null, valorTotal: 300, valorFrete: 300 }),
      ],
      abastecimentos: [
        { id: "a1", tipo: "DIESEL", litros: 123.4, valorTotal: null, emComboio: true, empresaPaga: false },
      ],
      precoMedioLitro: { DIESEL: "6.1234" },
      pedagiosAvulsos: [{ id: "p1", valor: 33.33, empresaPaga: true }],
      manutencoes: [{ id: "m1", data: new Date("2026-06-03"), descricao: "Freio", valor: 999.99 }],
      custosFixos: [
        { id: "c1", tipo: "PARCELA", valorMensal: 4321.09, vigenciaDe: new Date("2026-06-10"), vigenciaAte: null },
      ],
    });
    const c2 = caminhao("BBB2B22", {
      custosFixos: [
        { id: "c2", tipo: "SEGURO", valorMensal: 600, vigenciaDe: new Date("2026-01-01"), vigenciaAte: null },
      ],
    });
    const r = calcularResultadoObras([c1, c2]);

    const l1 = calcularLucroVeiculo(c1.entrada as EntradaLucroVeiculo);
    const l2 = calcularLucroVeiculo(c2.entrada as EntradaLucroVeiculo);

    // Categoria por categoria, ao centavo.
    expect(n(r.total.custos.motorista)).toBeCloseTo(n(l1.custos.motorista) + n(l2.custos.motorista), 2);
    expect(n(r.total.custos.combustivel)).toBeCloseTo(n(l1.custos.combustivel), 2);
    expect(n(r.total.custos.pedagio) + n(r.total.custos.pedagioAvulso)).toBeCloseTo(n(l1.custos.pedagio), 2);
    expect(n(r.total.custos.manutencao)).toBeCloseTo(n(l1.custos.manutencao), 2);
    expect(n(r.total.custos.custosFixos)).toBeCloseTo(n(l1.custos.custosFixos) + n(l2.custos.custosFixos), 2);
    expect(n(r.total.receita.frete) + n(r.total.receita.pedagio)).toBeCloseTo(n(l1.faturou), 2);
    // O gastou do lucro arredonda a soma; aqui arredonda cada parcela. No
    // máximo um centavo por caminhão de diferença.
    expect(Math.abs(n(r.total.custo) - (n(l1.gastou) + n(l2.gastou)))).toBeLessThanOrEqual(0.02);
    expect(r.conferencia).toEqual({
      faturouLucro: new Prisma.Decimal(l1.faturou).add(l2.faturou).toFixed(2),
      gastouLucro: new Prisma.Decimal(l1.gastou).add(l2.gastou).toFixed(2),
    });

    // O caminhão sem viagem não some: vira parado.
    expect(r.parado?.caminhoes).toEqual([{ veiculoId: "BBB2B22", placa: "BBB2B22", custo: "600.00" }]);
    // A viagem sem obra também não.
    expect(r.semObra?.viagens).toBe(1);
  });

  it("pedágio da viagem é direto, de UMA fonte, e só quando a empresa pagou", () => {
    const r = calcularResultadoObras([
      caminhao("AAA1A11", {
        viagens: [
          // Nativo e linha antiga ao mesmo tempo: vale só o nativo.
          viagem({ id: "v1", obra: OBRA_A, valorPedagioTotal: 80, pedagios: [{ id: "p", valor: 80 }] }),
          viagem({ id: "v2", obra: OBRA_B, valorPedagioTotal: 50, regra: regra({ reembolsaPedagio: false }) }),
        ],
      }),
    ]);
    expect(r.obras.find((o) => o.chave === "obra-a")!.custos.pedagio).toBe("80.00");
    expect(r.obras.find((o) => o.chave === "obra-b")!.custos.pedagio).toBe("0.00");
  });

  it("viagem sem preço: custo entra, receita não, e é contada à parte", () => {
    const r = calcularResultadoObras([
      caminhao("AAA1A11", {
        viagens: [
          viagem({ id: "v1", km: 100, valorTotal: 1000 }),
          viagem({ id: "v2", km: 100, valorTotal: null, valorFrete: null, toneladas: 20 }),
        ],
        custosFixos: [
          { id: "c1", tipo: "SEGURO", valorMensal: 300, vigenciaDe: new Date("2026-01-01"), vigenciaAte: null },
        ],
      }),
    ]);
    const a = r.obras[0]!;
    expect(a.receita.total).toBe("1000.00");
    expect(a.semPreco).toEqual({ viagens: 1, toneladas: "20.000", custo: "250.00" });
    expect(a.avisos.viagensSemPreco).toBe(1);
    expect(a.custo).toBe("500.00");
  });

  it("receita separa frete, pedágio repassado e estadia", () => {
    const r = calcularResultadoObras([
      caminhao("AAA1A11", {
        viagens: [viagem({ valorTotal: 650, valorFrete: 600, pedagioCobrado: 50, estadia: 120 })],
      }),
    ]);
    expect(r.obras[0]!.receita).toEqual({ frete: "600.00", pedagio: "50.00", estadia: "120.00", total: "770.00" });
    expect(r.obras[0]!.porTonelada).toEqual({ receita: "25.67", custo: "3.33", margem: "22.33" });
    expect(r.obras[0]!.porViagem?.margem).toBe("670.00");
  });

  it("filtro por cliente pagador poda as linhas, não o rateio", () => {
    const caminhoes = [
      caminhao("AAA1A11", {
        viagens: [viagem({ id: "v1", km: 100, obra: OBRA_A }), viagem({ id: "v2", km: 100, obra: OBRA_B })],
        custosFixos: [
          { id: "c1", tipo: "SEGURO", valorMensal: 300, vigenciaDe: new Date("2026-01-01"), vigenciaAte: null },
        ],
      }),
    ];
    const r = calcularResultadoObras(caminhoes, "emp-1");
    expect(r.obras.map((o) => o.chave)).toEqual(["obra-a"]);
    expect(r.obras[0]!.custos.custosFixos).toBe("150.00");
    expect(r.semObra).toBeNull();
    expect(r.parado).toBeNull();
    expect(r.conferencia).toBeNull();
    expect(r.total.custo).toBe(r.obras[0]!.custo);
  });

  it("motorista empregado: sem custo direto, avisado; o salário vem pelo custo fixo", () => {
    const r = calcularResultadoObras([
      caminhao("AAA1A11", { viagens: [viagem({ regra: null })] }),
    ]);
    expect(r.obras[0]!.custos.motorista).toBe("0.00");
    expect(r.obras[0]!.avisos.viagensEmpregado).toBe(1);
  });
});
