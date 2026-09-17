import { describe, expect, it } from "vitest";
import { trechoForaDoPortugues } from "./idioma-resposta";

describe("resposta fora do português", () => {
  it("pega o caso real que o MiniMax produziu", () => {
    const r = trechoForaDoPortugues("Tá certo, não vou te писать mais.");
    expect(r).toContain("писать");
  });

  it("pega chinês, japonês, coreano e árabe", () => {
    expect(trechoForaDoPortugues("ok 好的")).not.toBeNull();
    expect(trechoForaDoPortugues("ok はい")).not.toBeNull();
    expect(trechoForaDoPortugues("ok 네")).not.toBeNull();
    expect(trechoForaDoPortugues("ok نعم")).not.toBeNull();
  });

  it("deixa passar português de verdade, com acento e pontuação", () => {
    expect(
      trechoForaDoPortugues("R$ 1.890,00 por mês. Não é ERP — é pra carga a granel; funciona offline."),
    ).toBeNull();
  });

  it("deixa passar emoji", () => {
    expect(trechoForaDoPortugues("Pode chamar 🚛")).toBeNull();
  });

  it("texto vazio não é erro", () => {
    expect(trechoForaDoPortugues("")).toBeNull();
  });
});
