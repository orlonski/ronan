import { describe, expect, it } from "vitest";
import {
  apurarTitulo,
  custoPorKm,
  diasDeAtraso,
  faixaDeAging,
  gerarParcelas,
  montarAging,
  statusDoTitulo,
  vencimentoPeloPrazo,
  type TituloParaAging,
} from "./financeiro";

const HOJE = new Date("2026-06-10T12:00:00Z");

describe("statusDoTitulo", () => {
  it("sem baixa é ABERTO", () => {
    expect(statusDoTitulo(1000, 0)).toBe("ABERTO");
  });

  it("baixa parcial é PARCIAL", () => {
    expect(statusDoTitulo(1000, 400)).toBe("PARCIAL");
  });

  it("baixa completa é PAGO", () => {
    expect(statusDoTitulo(1000, 1000)).toBe("PAGO");
  });

  it("pagamento a MAIOR quita", () => {
    // Juro, arredondamento do banco. Deixar PARCIAL seria perseguir o cliente
    // por uma dívida que não existe.
    expect(statusDoTitulo(1000, 1000.5)).toBe("PAGO");
  });

  it("cancelado não é recalculado", () => {
    // Cancelar é decisão de alguém; a primeira baixa que chegasse apagaria isso.
    expect(statusDoTitulo(1000, 1000, "CANCELADO")).toBe("CANCELADO");
  });
});

describe("apurarTitulo", () => {
  it("soma as baixas e devolve o saldo", () => {
    const r = apurarTitulo(1000, [{ valor: 300 }, { valor: 200 }]);
    expect(r.valorPago).toBe("500.00");
    expect(r.saldo).toBe("500.00");
    expect(r.status).toBe("PARCIAL");
  });

  it("saldo nunca fica negativo", () => {
    const r = apurarTitulo(1000, [{ valor: 1200 }]);
    expect(r.saldo).toBe("0.00");
    expect(r.status).toBe("PAGO");
  });

  it("sem baixa nenhuma o saldo é o valor cheio", () => {
    expect(apurarTitulo(1000, []).saldo).toBe("1000.00");
  });

  it("não usa float: centavos somam exato", () => {
    // 0.1 + 0.2 em float dá 0.30000000000000004. Em Decimal, dá 0.30.
    const r = apurarTitulo(1, [{ valor: "0.1" }, { valor: "0.2" }]);
    expect(r.valorPago).toBe("0.30");
    expect(r.saldo).toBe("0.70");
  });
});

describe("aging", () => {
  it("conta os dias ignorando a hora", () => {
    // Vencimento é dia, não instante: 23h59 do dia do vencimento não está
    // vencido.
    expect(diasDeAtraso(new Date("2026-06-10T23:59:00Z"), HOJE)).toBe(0);
    expect(diasDeAtraso(new Date("2026-06-05"), HOJE)).toBe(5);
  });

  it("classifica nas faixas que o financeiro usa", () => {
    expect(faixaDeAging(new Date("2026-06-20"), HOJE)).toBe("A_VENCER");
    expect(faixaDeAging(new Date("2026-06-10"), HOJE)).toBe("VENCE_HOJE");
    expect(faixaDeAging(new Date("2026-06-01"), HOJE)).toBe("ATE_15");
    expect(faixaDeAging(new Date("2026-05-20"), HOJE)).toBe("DE_16_A_30");
    expect(faixaDeAging(new Date("2026-04-20"), HOJE)).toBe("DE_31_A_60");
    expect(faixaDeAging(new Date("2026-01-10"), HOJE)).toBe("ACIMA_60");
  });

  it("soma o saldo por faixa", () => {
    const titulos: TituloParaAging[] = [
      { vencimento: new Date("2026-06-20"), valor: 1000, valorPago: 0, status: "ABERTO" },
      { vencimento: new Date("2026-06-01"), valor: 500, valorPago: 200, status: "PARCIAL" },
      // 05/05 → 36 dias de atraso em 10/06: faixa de 31 a 60.
      { vencimento: new Date("2026-05-05"), valor: 800, valorPago: 0, status: "ABERTO" },
    ];
    const r = montarAging(titulos, HOJE);
    expect(r.faixas.A_VENCER).toBe("1000.00");
    expect(r.faixas.ATE_15).toBe("300.00"); // só o saldo
    expect(r.faixas.DE_31_A_60).toBe("800.00");
    expect(r.total).toBe("2100.00");
    expect(r.vencido).toBe("1100.00");
  });

  it("título pago e cancelado NÃO entram", () => {
    // Somar qualquer um dos dois infla o "a receber" — e é assim que se perde a
    // confiança no número.
    const titulos: TituloParaAging[] = [
      { vencimento: new Date("2026-05-01"), valor: 1000, valorPago: 1000, status: "PAGO" },
      { vencimento: new Date("2026-05-01"), valor: 500, valorPago: 0, status: "CANCELADO" },
    ];
    const r = montarAging(titulos, HOJE);
    expect(r.total).toBe("0.00");
  });
});

describe("gerarParcelas", () => {
  it("divide em parcelas com vencimento de 30 em 30", () => {
    const p = gerarParcelas({
      valorTotal: 900,
      parcelas: 3,
      primeiroVencimento: new Date("2026-07-10"),
    });
    expect(p).toHaveLength(3);
    expect(p[0]!.valor).toBe("300.00");
    expect(p[1]!.vencimento.toISOString().slice(0, 10)).toBe("2026-08-09");
    expect(p[2]!.vencimento.toISOString().slice(0, 10)).toBe("2026-09-08");
  });

  it("o resto dos centavos vai na ÚLTIMA parcela", () => {
    // 1000/3 = 333,333… Três de 333,33 somam 999,99 e faltaria 1 centavo.
    const p = gerarParcelas({
      valorTotal: 1000,
      parcelas: 3,
      primeiroVencimento: new Date("2026-07-10"),
    });
    expect(p[0]!.valor).toBe("333.33");
    expect(p[1]!.valor).toBe("333.33");
    expect(p[2]!.valor).toBe("333.34");
    const soma = p.reduce((s, x) => s + Number(x.valor), 0);
    expect(soma.toFixed(2)).toBe("1000.00");
  });

  it("uma parcela é o valor cheio", () => {
    const p = gerarParcelas({
      valorTotal: 1234.56,
      parcelas: 1,
      primeiroVencimento: new Date("2026-07-10"),
    });
    expect(p).toHaveLength(1);
    expect(p[0]!.valor).toBe("1234.56");
  });
});

describe("vencimentoPeloPrazo", () => {
  it("conta do FIM do período, não da viagem", () => {
    // "30 dias" significa 30 dias depois do dia 30 do fechamento.
    const v = vencimentoPeloPrazo(new Date("2026-06-30"), 30);
    expect(v.toISOString().slice(0, 10)).toBe("2026-07-30");
  });

  it("sem prazo cadastrado assume 30 dias", () => {
    const v = vencimentoPeloPrazo(new Date("2026-06-30"), null);
    expect(v.toISOString().slice(0, 10)).toBe("2026-07-30");
  });
});

describe("custoPorKm", () => {
  it("soma fixo e variável e divide pelo km", () => {
    const r = custoPorKm({ fixo: 4000, variavel: 8000, kmRodado: 6000 });
    expect(r.custoTotal).toBe("12000.00");
    expect(r.custoPorKm).toBe("2.00");
  });

  it("calcula margem quando há receita", () => {
    const r = custoPorKm({ fixo: 4000, variavel: 8000, kmRodado: 6000, receita: 20000 });
    expect(r.margem).toBe("8000.00");
    expect(r.margemPercentual).toBe(40);
  });

  it("margem negativa aparece como negativa", () => {
    // O caminhão que dá prejuízo é justamente o que o dono quer achar.
    const r = custoPorKm({ fixo: 4000, variavel: 8000, kmRodado: 6000, receita: 9000 });
    expect(r.margem).toBe("-3000.00");
    expect(r.margemPercentual).toBeLessThan(0);
  });

  it("km zero devolve null, não zero", () => {
    // Custo/km de R$ 0,00 num caminhão parado é pior que um traço.
    const r = custoPorKm({ fixo: 4000, variavel: 0, kmRodado: 0 });
    expect(r.custoPorKm).toBeNull();
    expect(r.custoTotal).toBe("4000.00");
  });

  it("sem receita não inventa margem", () => {
    const r = custoPorKm({ fixo: 100, variavel: 100, kmRodado: 100 });
    expect(r.margem).toBeNull();
    expect(r.margemPercentual).toBeNull();
  });
});
