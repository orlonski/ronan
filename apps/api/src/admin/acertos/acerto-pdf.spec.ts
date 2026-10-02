import { describe, expect, it } from "vitest";
import { textoPdf } from "./acerto-pdf.service";

describe("textoPdf", () => {
  it("troca seta e menos tipográfico pelo que a Helvetica desenha", () => {
    expect(textoPdf("Pedreira → Obra")).toBe("Pedreira -> Obra");
    expect(textoPdf("− R$ 10")).toBe("- R$ 10");
  });
  it("mantém acento, ponto médio e travessão; tira emoji", () => {
    expect(textoPdf("Viagem 02/09 · Ação — ok 🚚")).toBe("Viagem 02/09 · Ação — ok ");
  });
});
