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
});
