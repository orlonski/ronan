import { describe, expect, it } from "vitest";
import { calcularValorViagem, tabelaPrecoAplicada, type TabelaPrecoRow } from "./viagem-preco";

const EMPRESA = "emp-1";
const BRITA = "mat-brita";
const AREIA = "mat-areia";
const DIARIA = "srv-diaria";

function linha(over: Partial<TabelaPrecoRow> = {}): TabelaPrecoRow {
  return {
    id: "t1",
    empresaId: EMPRESA,
    materialId: null,
    tipoServicoId: null,
    kmFaixaDe: 0,
    kmFaixaAte: null,
    base: "TONELADA",
    precoUnitario: 10,
    repassaPedagio: false,
    vigenciaDe: new Date("2026-01-01"),
    vigenciaAte: null,
    ativo: true,
    ...over,
  };
}

const ARGS = {
  empresaId: EMPRESA,
  materialId: BRITA,
  tipoServicoId: null,
  kmReal: 50,
  data: "2026-06-15",
};

describe("tabelaPrecoAplicada", () => {
  it("não acha nada quando a empresa não tem tabela", () => {
    expect(tabelaPrecoAplicada([linha({ empresaId: "outra" })], ARGS)).toBeNull();
  });

  it("ignora linha inativa", () => {
    expect(tabelaPrecoAplicada([linha({ ativo: false })], ARGS)).toBeNull();
  });

  it("respeita a faixa: de inclusivo, até exclusivo", () => {
    const t = [linha({ id: "baixa", kmFaixaDe: 0, kmFaixaAte: 50 })];
    expect(tabelaPrecoAplicada(t, { ...ARGS, kmReal: 49.99 })?.id).toBe("baixa");
    // 50 é o teto exclusivo: já não pertence a esta faixa.
    expect(tabelaPrecoAplicada(t, { ...ARGS, kmReal: 50 })).toBeNull();
  });

  it("material específico vence a linha de qualquer material", () => {
    const t = [linha({ id: "geral" }), linha({ id: "brita", materialId: BRITA })];
    expect(tabelaPrecoAplicada(t, ARGS)?.id).toBe("brita");
  });

  it("linha de outro material não casa", () => {
    const t = [linha({ id: "areia", materialId: AREIA })];
    expect(tabelaPrecoAplicada(t, ARGS)).toBeNull();
  });

  it("entre iguais, a faixa mais estreita vence", () => {
    const t = [
      linha({ id: "larga", kmFaixaDe: 0 }),
      linha({ id: "estreita", kmFaixaDe: 40, kmFaixaAte: 80 }),
    ];
    expect(tabelaPrecoAplicada(t, ARGS)?.id).toBe("estreita");
  });

  it("modo de serviço específico vence até faixa mais estreita", () => {
    // A linha genérica é mais estreita, mas cobrar diária por tonelada é o erro
    // que esse desempate existe pra impedir.
    const t = [
      linha({ id: "frete-estreito", kmFaixaDe: 40 }),
      linha({ id: "diaria", tipoServicoId: DIARIA, base: "PERIODO", kmFaixaDe: 0 }),
    ];
    expect(tabelaPrecoAplicada(t, { ...ARGS, tipoServicoId: DIARIA })?.id).toBe("diaria");
  });

  it("ignora linha fora da vigência", () => {
    const t = [
      linha({ id: "velha", vigenciaDe: new Date("2026-01-01"), vigenciaAte: new Date("2026-05-31") }),
    ];
    expect(tabelaPrecoAplicada(t, ARGS)).toBeNull();
  });

  it("vigenciaAte é inclusivo — o último dia ainda vale", () => {
    const t = [linha({ id: "ate-hoje", vigenciaAte: new Date("2026-06-15") })];
    expect(tabelaPrecoAplicada(t, ARGS)?.id).toBe("ate-hoje");
  });

  it("em empate, vale a vigência que começou por último (o reajuste)", () => {
    const t = [
      linha({ id: "antigo", precoUnitario: 10, vigenciaDe: new Date("2026-01-01") }),
      linha({ id: "reajustado", precoUnitario: 12, vigenciaDe: new Date("2026-06-01") }),
    ];
    expect(tabelaPrecoAplicada(t, ARGS)?.id).toBe("reajustado");
  });
});

describe("calcularValorViagem", () => {
  const viagem = {
    toneladas: "30",
    km: "50",
    status: "OK" as const,
    data: "2026-06-15",
    valorPedagioTotal: "40",
    tipoServicoId: null,
    tipoServico: { medicao: "PESO" as const },
  };

  it("multiplica o preço pela tonelada efetiva", () => {
    const r = calcularValorViagem(viagem, {
      empresaId: EMPRESA,
      materialId: BRITA,
      tabelas: [linha({ precoUnitario: 12 })],
    });
    expect(r.valor?.valorFrete).toBe("360.00");
    expect(r.valor?.quantidade).toBe("30.000");
    // Sem repasse, o pedágio não entra no total.
    expect(r.valor?.valorTotal).toBe("360.00");
  });

  it("usa a tonelada do MÍNIMO quando o real ficou abaixo", () => {
    // O cerne da regra: 20t reais, mínimo de 27t, preço de R$ 10 → 270, não 200.
    const r = calcularValorViagem(
      { ...viagem, toneladas: "20" },
      {
        empresaId: EMPRESA,
        materialId: BRITA,
        tabelas: [linha({ precoUnitario: 10 })],
        minimo: { toneladasMinimo: 27 as never, kmMinimo: null },
      },
    );
    expect(r.valor?.quantidade).toBe("27.000");
    expect(r.valor?.valorFrete).toBe("270.00");
  });

  it("soma o pedágio quando a linha repassa", () => {
    const r = calcularValorViagem(viagem, {
      empresaId: EMPRESA,
      materialId: BRITA,
      tabelas: [linha({ precoUnitario: 10, repassaPedagio: true })],
    });
    expect(r.valor?.valorFrete).toBe("300.00");
    expect(r.valor?.valorPedagio).toBe("40.00");
    expect(r.valor?.valorTotal).toBe("340.00");
  });

  it("base KM multiplica o km efetivo", () => {
    const r = calcularValorViagem(viagem, {
      empresaId: EMPRESA,
      materialId: BRITA,
      tabelas: [linha({ base: "KM", precoUnitario: "4.50" })],
    });
    // quantidade é sempre Decimal(12,3), seja tonelada ou km.
    expect(r.valor?.quantidade).toBe("50.000");
    expect(r.valor?.valorFrete).toBe("225.00");
  });

  it("base VIAGEM é valor fechado, quantidade 1", () => {
    const r = calcularValorViagem(viagem, {
      empresaId: EMPRESA,
      materialId: BRITA,
      tabelas: [linha({ base: "VIAGEM", precoUnitario: 800 })],
    });
    expect(r.valor?.quantidade).toBe("1.000");
    expect(r.valor?.valorFrete).toBe("800.00");
  });

  it("viagem incompleta não vale nada", () => {
    for (const status of ["EM_ANDAMENTO", "AGUARDANDO_PESO", "INCOMPLETA"] as const) {
      const r = calcularValorViagem(
        { ...viagem, status },
        { empresaId: EMPRESA, materialId: BRITA, tabelas: [linha()] },
      );
      expect(r.motivo).toBe("VIAGEM_INCOMPLETA");
    }
  });

  it("viagem sem empresa não tem de quem cobrar", () => {
    const r = calcularValorViagem(viagem, { empresaId: null, materialId: BRITA, tabelas: [linha()] });
    expect(r.motivo).toBe("SEM_EMPRESA");
  });

  it("sem tabela que case, fica sem valor — e isso não é erro", () => {
    const r = calcularValorViagem(viagem, { empresaId: EMPRESA, materialId: BRITA, tabelas: [] });
    expect(r.motivo).toBe("SEM_TABELA");
  });

  it("diária NUNCA é cobrada por tonelada", () => {
    // Caminhão à disposição pode não sair do pátio: 0t vezes o preço seria zero,
    // e 27t (o mínimo) vezes o preço seria dinheiro inventado. Recusa.
    const r = calcularValorViagem(
      { ...viagem, toneladas: "0", km: "0", tipoServico: { medicao: "PERIODO" }, tipoServicoId: DIARIA },
      {
        empresaId: EMPRESA,
        materialId: null,
        tabelas: [linha({ base: "TONELADA", tipoServicoId: DIARIA })],
      },
    );
    expect(r.motivo).toBe("BASE_INCOMPATIVEL");
  });

  it("diária com preço de período vale o valor cheio, mesmo com 0t e 0km", () => {
    const r = calcularValorViagem(
      { ...viagem, toneladas: "0", km: "0", tipoServico: { medicao: "PERIODO" }, tipoServicoId: DIARIA },
      {
        empresaId: EMPRESA,
        materialId: null,
        tabelas: [linha({ base: "PERIODO", precoUnitario: 950, tipoServicoId: DIARIA })],
      },
    );
    expect(r.valor?.valorFrete).toBe("950.00");
  });

  it("frete normal não usa preço de diária", () => {
    const r = calcularValorViagem(viagem, {
      empresaId: EMPRESA,
      materialId: BRITA,
      tabelas: [linha({ base: "PERIODO", precoUnitario: 950 })],
    });
    expect(r.motivo).toBe("BASE_INCOMPATIVEL");
  });
});
