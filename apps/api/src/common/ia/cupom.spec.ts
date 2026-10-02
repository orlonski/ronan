import { describe, expect, it } from "vitest";
import { cupomDoJson } from "./cupom";

describe("cupomDoJson", () => {
  it("lê o cupom normal e calcula o preço do litro", () => {
    expect(
      cupomDoJson({ litros: 300, valorTotal: "1.830,00", postoNome: " Posto Rota 277 ", data: "01/09/2026", tipo: "OLEO DIESEL B S10", confidence: 0.9 }),
    ).toEqual({ litros: 300, valorTotal: 1830, precoLitro: 6.1, postoNome: "Posto Rota 277", data: "2026-09-01", tipo: "DIESEL_S10", confidence: 0.9 });
  });

  it("leitura trocada (preço do litro absurdo) não vira sugestão", () => {
    const r = cupomDoJson({ litros: 6.1, valorTotal: 1830, confidence: 0.8 });
    expect(r.litros).toBeUndefined();
    expect(r.valorTotal).toBeUndefined();
    expect(r.precoLitro).toBeUndefined();
  });

  it("fora do plausível some; ARLA e S500 reconhecidos; data impossível some", () => {
    expect(cupomDoJson({ litros: 5000, tipo: "ARLA 32", data: "31/02/2026" })).toMatchObject({
      litros: undefined,
      tipo: "ARLA_32",
      data: undefined,
      confidence: 0,
    });
    expect(cupomDoJson({ tipo: "DIESEL S-500" }).tipo).toBe("DIESEL_S500");
  });
});
