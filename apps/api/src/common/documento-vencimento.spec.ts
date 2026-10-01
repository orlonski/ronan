import { describe, expect, it } from "vitest";
import { diasParaVencer, ehDiaDeAvisar, situacaoDocumento, textoVencimento } from "./documento-vencimento";

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

describe("documento-vencimento", () => {
  it("conta os dias pelo calendário, não pela hora", () => {
    expect(diasParaVencer(d("2026-10-06"), "2026-10-01")).toBe(5);
    expect(diasParaVencer(d("2026-09-28"), "2026-10-01")).toBe(-3);
  });

  it("vencido, vence logo (até 15 dias) ou nada", () => {
    expect(situacaoDocumento(d("2026-09-30"), "2026-10-01")).toEqual({ situacao: "VENCIDO", dias: -1 });
    expect(situacaoDocumento(d("2026-10-16"), "2026-10-01")).toEqual({ situacao: "VENCE_LOGO", dias: 15 });
    expect(situacaoDocumento(d("2026-10-17"), "2026-10-01")).toBeNull();
    expect(situacaoDocumento(null, "2026-10-01")).toBeNull();
  });

  it("texto em português de gente", () => {
    expect(textoVencimento("CNH", -3)).toBe("CNH vencido(a) há 3 dias");
    expect(textoVencimento("CNH", -1)).toBe("CNH venceu ontem");
    expect(textoVencimento("CRLV", 0)).toBe("CRLV vence hoje");
    expect(textoVencimento("CRLV", 1)).toBe("CRLV vence amanhã");
    expect(textoVencimento("CRLV", 5)).toBe("CRLV vence em 5 dias");
  });

  it("o sininho toca com 15, 7, 1 e 0 dias — nunca todo dia", () => {
    expect([16, 15, 8, 7, 2, 1, 0, -1].filter(ehDiaDeAvisar)).toEqual([15, 7, 1, 0]);
  });
});
