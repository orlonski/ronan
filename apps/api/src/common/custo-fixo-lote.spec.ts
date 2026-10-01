import { describe, expect, it } from "vitest";
import {
  dataDoTexto,
  interpretarPlanilhaCustoFixo,
  tipoCustoFixoDoTexto,
  valorDoTexto,
} from "@ronan/shared-types";

/**
 * O leitor da planilha colada no lote de custos fixos. Mora em shared-types
 * (a tela usa pra mostrar o erro na hora); o teste fica aqui porque o api é o
 * único pacote com runner.
 */

describe("valorDoTexto", () => {
  it("entende o jeito brasileiro e o do sistema", () => {
    expect(valorDoTexto("R$ 1.234,56")).toBe(1234.56);
    expect(valorDoTexto("1234,5")).toBe(1234.5);
    expect(valorDoTexto("1234.56")).toBe(1234.56);
    expect(valorDoTexto("1.234")).toBe(1234);
    expect(valorDoTexto("850")).toBe(850);
  });

  it("recusa vazio, zero e texto", () => {
    expect(valorDoTexto("")).toBeNull();
    expect(valorDoTexto("0")).toBeNull();
    expect(valorDoTexto("abc")).toBeNull();
  });
});

describe("dataDoTexto", () => {
  it("aceita dd/mm/aaaa e AAAA-MM-DD", () => {
    expect(dataDoTexto("01/09/2026")).toBe("2026-09-01");
    expect(dataDoTexto("1/9/2026")).toBe("2026-09-01");
    expect(dataDoTexto("2026-09-01")).toBe("2026-09-01");
  });

  it("recusa dia que não existe", () => {
    expect(dataDoTexto("31/02/2026")).toBeNull();
    expect(dataDoTexto("setembro")).toBeNull();
  });
});

describe("tipoCustoFixoDoTexto", () => {
  it("entende como a pessoa escreve", () => {
    expect(tipoCustoFixoDoTexto("Seguro")).toBe("SEGURO");
    expect(tipoCustoFixoDoTexto("PARCELA")).toBe("FINANCIAMENTO");
    expect(tipoCustoFixoDoTexto("Salário")).toBe("SALARIO_MOTORISTA");
    expect(tipoCustoFixoDoTexto("depreciação")).toBe("DEPRECIACAO");
    expect(tipoCustoFixoDoTexto("pneu")).toBeNull();
  });
});

describe("interpretarPlanilhaCustoFixo", () => {
  it("lê o que vem do Excel (TAB), pula cabeçalho e usa a data padrão", () => {
    const texto = [
      "Placa\tCusto\tValor\tDesde",
      "ABC-1D23\tSeguro\tR$ 900,00\t01/01/2026",
      "XYZ9876\tIPVA\t300",
      "",
    ].join("\n");
    const r = interpretarPlanilhaCustoFixo(texto, "2026-10-01");
    expect(r.erros).toEqual([]);
    expect(r.itens).toEqual([
      { linha: 2, placa: "ABC-1D23", tipo: "SEGURO", valorMensal: 900, vigenciaDe: "2026-01-01" },
      { linha: 3, placa: "XYZ9876", tipo: "IPVA", valorMensal: 300, vigenciaDe: "2026-10-01" },
    ]);
  });

  it("aceita ponto e vírgula e aponta a linha de cada erro", () => {
    const texto = ["ABC1D23;Pneu;500", "ABC1D23;Seguro;abc", "ABC1D23;Seguro;900;31/02/2026", ";Seguro;900"].join("\n");
    const r = interpretarPlanilhaCustoFixo(texto, "2026-10-01");
    expect(r.itens).toEqual([]);
    expect(r.erros.map((e) => e.linha)).toEqual([1, 2, 3, 4]);
    expect(r.erros[0]!.mensagem).toContain("Pneu");
  });
});
