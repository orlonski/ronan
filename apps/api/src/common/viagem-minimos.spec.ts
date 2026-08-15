import { describe, it, expect } from "vitest";
import { aplicarMinimos } from "./viagem-minimos";
import { Prisma } from "@prisma/client";

const minimoDe27t = {
  toneladasMinimo: new Prisma.Decimal(27),
  kmMinimo: new Prisma.Decimal(100),
};

describe("aplicarMinimos", () => {
  it("frete abaixo do mínimo fatura pelo mínimo (comportamento de sempre)", () => {
    const r = aplicarMinimos({ toneladas: 20, km: 50 }, minimoDe27t);
    expect(r.toneladasEfetiva).toBe("27.000");
    expect(r.kmEfetivo).toBe("100.00");
    expect(r.toneladasAjustada).toBe(true);
  });

  it("frete acima do mínimo fatura o real", () => {
    const r = aplicarMinimos({ toneladas: 30, km: 200 }, minimoDe27t);
    expect(r.toneladasEfetiva).toBe("30.000");
    expect(r.toneladasAjustada).toBe(false);
  });

  it("viagem sem tipoServico é tratada como frete (histórico intocado)", () => {
    const r = aplicarMinimos({ toneladas: 20, km: 50, tipoServico: null }, minimoDe27t);
    expect(r.toneladasEfetiva).toBe("27.000");
  });

  it("DIÁRIA nunca ganha tonelagem mínima — a tonelagem fantasma", () => {
    const r = aplicarMinimos(
      { toneladas: null, km: null, tipoServico: { medicao: "PERIODO" } },
      minimoDe27t,
    );
    expect(r.toneladasEfetiva).toBe("0.000");
    expect(r.toneladasAjustada).toBe(false);
  });

  it("DIÁRIA também não ganha km mínimo (caminhão parado no pátio)", () => {
    const r = aplicarMinimos(
      { toneladas: null, km: 0, tipoServico: { medicao: "PERIODO" } },
      minimoDe27t,
    );
    expect(r.kmEfetivo).toBe("0.00");
    expect(r.kmAjustada).toBe(false);
  });

  it("DIÁRIA com material cadastrado também não fura o guarda", () => {
    const r = aplicarMinimos(
      { toneladas: null, km: 30, tipoServico: { medicao: "PERIODO" } },
      minimoDe27t,
    );
    expect(r.toneladasEfetiva).toBe("0.000");
    expect(r.kmEfetivo).toBe("30.00");
  });
});
