import { describe, expect, it } from "vitest";
import {
  ajusteDaDecisao,
  decisaoAindaVale,
  pedagioDoCliente,
  pedagioPelaTag,
  situacaoTagDaViagem,
  sugestaoDeReembolso,
} from "./pedagio-lancado";

describe("pedágio lançado × tag", () => {
  it("sugere devolver só o que a tag e o vale não cobriram", () => {
    expect(sugestaoDeReembolso("120", { tag: "78", vale: "0", trechos: 1 }).toFixed(2)).toBe("42.00");
    expect(sugestaoDeReembolso("120", { tag: "50", vale: "30", trechos: 2 }).toFixed(2)).toBe("40.00");
  });

  it("tag que pagou mais do que o lançado não vira dívida do motorista", () => {
    expect(sugestaoDeReembolso("50", { tag: "136.50", vale: "0", trechos: 1 }).toFixed(2)).toBe("0.00");
  });

  it("passagem ligada vence: mostra o que a tag pagou e a sugestão", () => {
    const s = situacaoTagDaViagem({
      temTag: true,
      faturaCobreODia: true,
      cobertura: { tag: "0", vale: "136.50", trechos: 1 },
      lancado: "136.50",
    });
    expect(s).toEqual({ situacao: "TAG_PAGOU", tag: "0.00", vale: "136.50", retorno: "0.00", sugestao: "0.00" });
  });

  it("sem passagem ligada: diz por quê (sem tag, fatura não chegou, não casada)", () => {
    expect(situacaoTagDaViagem({ temTag: false, faturaCobreODia: false, cobertura: null, lancado: "10" })).toEqual({
      situacao: "SEM_TAG",
    });
    expect(situacaoTagDaViagem({ temTag: true, faturaCobreODia: false, cobertura: null, lancado: "10" })).toEqual({
      situacao: "FATURA_NAO_CHEGOU",
    });
    expect(
      situacaoTagDaViagem({ temTag: true, faturaCobreODia: true, cobertura: { tag: 0, vale: 0, trechos: 0 }, lancado: "10" }),
    ).toEqual({ situacao: "NAO_CASADA" });
  });

  it("decisão só vale pros números sobre os quais foi tomada", () => {
    const c = { tag: "78", vale: "0", trechos: 1 };
    const d = { valorLancado: "120.00", valorTag: "78.00" };
    expect(decisaoAindaVale(d, "120", c)).toBe(true);
    expect(decisaoAindaVale(d, "150", c)).toBe(false);
    // A ligação foi desfeita: a tag não pagou nada nesta viagem.
    expect(decisaoAindaVale(d, "120", null)).toBe(false);
  });

  it("a volta vazia na tag não entra na sugestão (ele pode ter lançado só a ida)", () => {
    expect(sugestaoDeReembolso("120", { tag: "0", vale: "0", retorno: "78", trechos: 1 }).toFixed(2)).toBe("120.00");
  });

  it("pedágio pro cliente pela régua: ida, volta, as duas — vale nunca", () => {
    const c = { tag: "103.60", vale: "40", retorno: "58.50", trechos: 2, trechosIda: 1, trechosVolta: 1 };
    expect(pedagioPelaTag(c, "IDA")?.toFixed(2)).toBe("103.60");
    expect(pedagioPelaTag(c, "VOLTA")?.toFixed(2)).toBe("58.50");
    expect(pedagioPelaTag(c, "IDA_E_VOLTA")?.toFixed(2)).toBe("162.10");
  });

  it("a parte que a régua pede não está ligada: vale o lançado", () => {
    const soVolta = { tag: "0", vale: "0", retorno: "58.50", trechos: 1, trechosIda: 0, trechosVolta: 1 };
    expect(pedagioPelaTag(soVolta, "IDA")).toBeNull();
    expect(pedagioPelaTag(null, "IDA")).toBeNull();
    expect(pedagioDoCliente({ pedagioPelaTag: null, valorPedagioTotal: "120" }).toFixed(2)).toBe("120.00");
    expect(pedagioDoCliente({ pedagioPelaTag: "0", valorPedagioTotal: "120" }).toFixed(2)).toBe("0.00");
  });

  it("ajuste no acerto seguinte: o decidido menos o já pago", () => {
    expect(ajusteDaDecisao("42", "120").toFixed(2)).toBe("-78.00");
    expect(ajusteDaDecisao("120", "120").toFixed(2)).toBe("0.00");
  });
});
