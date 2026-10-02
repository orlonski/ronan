import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { densidadeValida, m3ParaToneladas, toneladasParaM3 } from "./volume-material";

describe("toneladasParaM3", () => {
  it("divide as toneladas pela densidade", () => {
    const r = toneladasParaM3(29, 1.45);
    expect(r.ok && r.valor.toFixed(3)).toBe("20.000");
  });

  it("arredonda em 3 casas (meio pra cima)", () => {
    // 10 / 1,5 = 6,6666…
    const r = toneladasParaM3("10", "1.5");
    expect(r.ok && r.valor.toFixed()).toBe("6.667");
  });

  it("aceita Decimal do Prisma", () => {
    const r = toneladasParaM3(new Prisma.Decimal("27.550"), new Prisma.Decimal("1.450"));
    expect(r.ok && r.valor.toFixed(3)).toBe("19.000");
  });

  it("sem densidade recusa, nunca chuta", () => {
    expect(toneladasParaM3(29, null)).toEqual({ ok: false, motivo: "SEM_DENSIDADE" });
    expect(toneladasParaM3(29, undefined)).toEqual({ ok: false, motivo: "SEM_DENSIDADE" });
  });

  it("densidade zero ou negativa conta como sem densidade (não divide por zero)", () => {
    expect(toneladasParaM3(29, 0)).toEqual({ ok: false, motivo: "SEM_DENSIDADE" });
    expect(toneladasParaM3(29, -1.4)).toEqual({ ok: false, motivo: "SEM_DENSIDADE" });
  });

  it("zero tonelada com densidade é zero m³ (é medida, não ausência)", () => {
    const r = toneladasParaM3(0, 1.45);
    expect(r.ok && r.valor.toFixed(3)).toBe("0.000");
  });
});

describe("m3ParaToneladas", () => {
  it("multiplica o volume pela densidade", () => {
    const r = m3ParaToneladas(20, 1.45);
    expect(r.ok && r.valor.toFixed(3)).toBe("29.000");
  });

  it("sem densidade recusa", () => {
    expect(m3ParaToneladas(20, null)).toEqual({ ok: false, motivo: "SEM_DENSIDADE" });
  });

  it("ida e volta fecha dentro do arredondamento", () => {
    const m3 = toneladasParaM3(31.7, 1.52);
    expect(m3.ok).toBe(true);
    if (!m3.ok) return;
    const t = m3ParaToneladas(m3.valor, 1.52);
    expect(t.ok && Math.abs(t.valor.toNumber() - 31.7)).toBeLessThan(0.001);
  });
});

describe("densidadeValida", () => {
  it("devolve a densidade como Decimal ou null", () => {
    expect(densidadeValida("1.450")?.toFixed(3)).toBe("1.450");
    expect(densidadeValida(null)).toBeNull();
    expect(densidadeValida(0)).toBeNull();
  });
});
