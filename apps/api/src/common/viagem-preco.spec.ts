import { describe, expect, it } from "vitest";
import {
  calcularValorViagem,
  mudouInsumoDePreco,
  tabelaPrecoAplicada,
  type TabelaPrecoRow,
} from "./viagem-preco";

const EMPRESA = "emp-1";
const BRITA = "mat-brita";
const AREIA = "mat-areia";
const MODO = "srv-especifico";

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
    // A linha genérica é mais estreita, mas a feita pra aquele modo vence.
    const t = [
      linha({ id: "frete-estreito", kmFaixaDe: 40 }),
      linha({ id: "do-modo", tipoServicoId: MODO, kmFaixaDe: 0 }),
    ];
    expect(tabelaPrecoAplicada(t, { ...ARGS, tipoServicoId: MODO })?.id).toBe("do-modo");
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
});

describe("mudouInsumoDePreco", () => {
  it("pega o pedágio — o insumo que faltava na lista", () => {
    // O defeito: corrigir o pedágio no painel deixava a viagem certa e a
    // fatura errada, numa empresa com `repassaPedagio`. Pior que valor
    // faltando, porque parece certo.
    expect(mudouInsumoDePreco({ valorPedagioTotal: 40 })).toBe(true);
  });

  it("LIMPAR o pedágio também conta", () => {
    // `null` é "apague o pedágio", e isso muda o total tanto quanto trocá-lo.
    // Uma checagem `!= null` deixaria este caso passar batido.
    expect(mudouInsumoDePreco({ valorPedagioTotal: null })).toBe(true);
  });

  it("os insumos clássicos continuam valendo", () => {
    for (const campo of ["km", "toneladas", "clienteId", "materialId", "data"]) {
      expect(mudouInsumoDePreco({ [campo]: 1 })).toBe(true);
    }
  });

  it("editar o que não entra no preço não refaz a conta", () => {
    // Recalcular à toa não corrompe nada, mas é consulta no caminho de toda
    // edição — e escondia que a lista estava incompleta.
    expect(mudouInsumoDePreco({ observacao: "x", placa: "ABC1D23" })).toBe(false);
    expect(mudouInsumoDePreco({})).toBe(false);
  });
});

describe("calcularValorViagem — base M3", () => {
  const viagem = {
    toneladas: "29",
    km: "50",
    status: "OK" as const,
    data: "2026-06-15",
    valorPedagioTotal: "0",
    tipoServicoId: null,
  };
  const porM3 = linha({ base: "M3", precoUnitario: 18 });

  it("converte a tonelada efetiva em m³ pela densidade e multiplica o preço", () => {
    // 29 t ÷ 1,45 t/m³ = 20 m³ × R$ 18 = R$ 360.
    const r = calcularValorViagem(viagem, {
      empresaId: EMPRESA,
      materialId: BRITA,
      tabelas: [porM3],
      densidadeTonM3: "1.45",
    });
    expect(r.valor?.base).toBe("M3");
    expect(r.valor?.quantidade).toBe("20.000");
    expect(r.valor?.valorFrete).toBe("360.00");
    // Congela a ponte da conta: densidade usada e toneladas convertidas.
    expect(r.valor?.densidadeTonM3).toBe("1.450");
    expect(r.valor?.toneladasConvertidas).toBe("29.000");
  });

  it("mínimo conta, preço vale: converte a tonelada do MÍNIMO, não a real", () => {
    // 20 t reais, mínimo 29 t → 29 ÷ 1,45 = 20 m³ (e não 13,793).
    const r = calcularValorViagem(
      { ...viagem, toneladas: "20" },
      {
        empresaId: EMPRESA,
        materialId: BRITA,
        tabelas: [porM3],
        minimo: { toneladasMinimo: 29 as never, kmMinimo: null },
        densidadeTonM3: 1.45,
      },
    );
    expect(r.valor?.toneladasConvertidas).toBe("29.000");
    expect(r.valor?.quantidade).toBe("20.000");
    expect(r.valor?.valorFrete).toBe("360.00");
  });

  it("o frete é o m³ GRAVADO (3 casas) vezes o preço — a conta reconstitui", () => {
    // 10 t ÷ 1,5 = 6,667 m³ (arredondado) × R$ 30 = 200,01 — não 200,00.
    const r = calcularValorViagem(
      { ...viagem, toneladas: "10" },
      {
        empresaId: EMPRESA,
        materialId: BRITA,
        tabelas: [linha({ base: "M3", precoUnitario: 30 })],
        densidadeTonM3: 1.5,
      },
    );
    expect(r.valor?.quantidade).toBe("6.667");
    expect(r.valor?.valorFrete).toBe("200.01");
  });

  it("sem densidade a viagem fica SEM valor, com motivo — nunca R$ 0", () => {
    const r = calcularValorViagem(viagem, {
      empresaId: EMPRESA,
      materialId: BRITA,
      tabelas: [porM3],
      densidadeTonM3: null,
    });
    expect(r.valor).toBeUndefined();
    expect(r.motivo).toBe("SEM_DENSIDADE");
  });

  it("densidade só importa na base M3", () => {
    const r = calcularValorViagem(viagem, {
      empresaId: EMPRESA,
      materialId: BRITA,
      tabelas: [linha({ precoUnitario: 10 })],
      densidadeTonM3: null,
    });
    expect(r.valor?.valorFrete).toBe("290.00");
    expect(r.valor?.densidadeTonM3).toBeNull();
    expect(r.valor?.toneladasConvertidas).toBeNull();
  });

  it("viagem incompleta continua sem valor antes de olhar densidade", () => {
    const r = calcularValorViagem(
      { ...viagem, status: "AGUARDANDO_PESO" as never },
      { empresaId: EMPRESA, materialId: BRITA, tabelas: [porM3], densidadeTonM3: 1.45 },
    );
    expect(r.motivo).toBe("VIAGEM_INCOMPLETA");
  });
});
