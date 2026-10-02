import { describe, expect, it } from "vitest";
import { calcularSobretaxa, precoMedioDiesel } from "./sobretaxa-combustivel";

const REGRA = { dieselReferencia: "6.00", gatilho: "0.10", percentualPorPasso: "0.5", tetoPercentual: null };

describe("precoMedioDiesel", () => {
  it("pondera pelos litros, não pela quantidade de abastecimentos", () => {
    // 600 l a 6,00 e 20 l a 9,00: média simples daria 7,50; o certo é 6,097.
    const r = precoMedioDiesel([
      { litros: "600", valorTotal: "3600.00" },
      { litros: "20", valorTotal: "180.00" },
    ]);
    expect(r?.preco.toFixed(3)).toBe("6.097");
    expect(r?.litros.toFixed(3)).toBe("620.000");
    expect(r?.abastecimentos).toBe(2);
  });

  it("ignora abastecimento sem valor (comboio sem preço) e sem litros", () => {
    const r = precoMedioDiesel([
      { litros: "500", valorTotal: null },
      { litros: "0", valorTotal: "10" },
      { litros: "100", valorTotal: "642.00" },
    ]);
    expect(r?.preco.toFixed(3)).toBe("6.420");
    expect(r?.abastecimentos).toBe(1);
  });

  it("sem abastecimento com preço não inventa média", () => {
    expect(precoMedioDiesel([])).toBeNull();
    expect(precoMedioDiesel([{ litros: "100", valorTotal: null }])).toBeNull();
  });
});

describe("calcularSobretaxa", () => {
  it("o exemplo do contrato: 6,42 x 6,00, passo de 0,10 a 0,5% → 4 passos = 2%", () => {
    const r = calcularSobretaxa(REGRA, "6.42", "48300");
    expect(r.passos).toBe(4);
    expect(r.percentual).toBe("2.000");
    expect(r.valor).toBe("966.00");
    expect(r.descricao).toBe(
      "Sobretaxa de combustível: diesel médio R$ 6,42 x referência R$ 6,00 → 4 passos de R$ 0,10 × 0,5% = 2% sobre R$ 48.300,00",
    );
    expect(r.descricao).not.toMatch(/\n/);
  });

  it("passo é inteiro: 0,09 acima não conta", () => {
    expect(calcularSobretaxa(REGRA, "6.09", "1000").passos).toBe(0);
    expect(calcularSobretaxa(REGRA, "6.09", "1000").valor).toBe("0.00");
  });

  it("não erra por float: 6,30 − 6,00 com gatilho 0,10 são 3 passos, não 2", () => {
    expect(calcularSobretaxa(REGRA, "6.3", "1000").passos).toBe(3);
    expect(calcularSobretaxa({ ...REGRA, dieselReferencia: "5.7" }, "6.0", "1000").passos).toBe(3);
  });

  it("exatamente na fronteira do passo conta o passo", () => {
    expect(calcularSobretaxa(REGRA, "6.10", "1000").passos).toBe(1);
  });

  it("diesel caindo não dá desconto", () => {
    const r = calcularSobretaxa(REGRA, "5.40", "10000");
    expect(r.passos).toBe(0);
    expect(r.percentual).toBe("0.000");
    expect(r.valor).toBe("0.00");
    expect(r.descricao).toContain("sem sobretaxa");
  });

  it("diesel igual à referência é zero", () => {
    expect(calcularSobretaxa(REGRA, "6.00", "10000").valor).toBe("0.00");
  });

  it("o teto limita o percentual e a descrição avisa", () => {
    const r = calcularSobretaxa({ ...REGRA, percentualPorPasso: "1", tetoPercentual: "5" }, "7.00", "20000");
    expect(r.passos).toBe(10);
    expect(r.percentual).toBe("5.000");
    expect(r.limitadoPeloTeto).toBe(true);
    expect(r.valor).toBe("1000.00");
    expect(r.descricao).toContain("(teto 5%)");
  });

  it("teto acima do calculado não mexe", () => {
    const r = calcularSobretaxa({ ...REGRA, tetoPercentual: "10" }, "6.42", "48300");
    expect(r.percentual).toBe("2.000");
    expect(r.limitadoPeloTeto).toBe(false);
  });

  it("arredonda o valor em centavos, meio pra cima", () => {
    // 1% de 1234,45 = 12,3445 → 12,34; 1% de 1234,50 = 12,345 → 12,35
    const um = { ...REGRA, percentualPorPasso: "1" };
    expect(calcularSobretaxa(um, "6.10", "1234.45").valor).toBe("12.34");
    expect(calcularSobretaxa(um, "6.10", "1234.50").valor).toBe("12.35");
  });

  it("diesel com milésimo aparece com milésimo (a conta usa o milésimo)", () => {
    const r = calcularSobretaxa(REGRA, "6.399", "1000");
    expect(r.passos).toBe(3);
    expect(r.descricao).toContain("R$ 6,399");
    expect(r.descricao).toContain("3 passos de");
  });

  it("um passo fica no singular", () => {
    expect(calcularSobretaxa(REGRA, "6.15", "1000").descricao).toContain("1 passo de");
  });

  it("gatilho zero é erro de cadastro, não divisão por zero calada", () => {
    expect(() => calcularSobretaxa({ ...REGRA, gatilho: "0" }, "7", "1000")).toThrow();
  });
});
