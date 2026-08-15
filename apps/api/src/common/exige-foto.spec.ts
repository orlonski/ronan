import { describe, it, expect } from "vitest";
import {
  exigeFotoDaViagem,
  resolverJustificativaSemFoto,
  SEM_JUSTIFICATIVA,
} from "./exige-foto";

describe("exigeFotoDaViagem", () => {
  it("conta que não configurou nada não exige (o padrão de hoje)", () => {
    expect(exigeFotoDaViagem({})).toBe(false);
    expect(exigeFotoDaViagem({ contaExige: false })).toBe(false);
    expect(exigeFotoDaViagem({ contaExige: null })).toBe(false);
  });

  it("conta que exige, material normal, frete comum: exige", () => {
    expect(
      exigeFotoDaViagem({
        contaExige: true,
        materialTemComprovante: true,
        modoExigeTicket: true,
      }),
    ).toBe(true);
  });

  it("material sem comprovante (concreto) suprime, mesmo com a conta exigindo", () => {
    expect(
      exigeFotoDaViagem({ contaExige: true, materialTemComprovante: false }),
    ).toBe(false);
  });

  it("diária suprime: não há romaneio pra fotografar", () => {
    expect(
      exigeFotoDaViagem({
        contaExige: true,
        materialTemComprovante: true,
        modoExigeTicket: false,
      }),
    ).toBe(false);
  });

  it("campos ausentes (app/cache antigo) não inventam exigência nem a cancelam à toa", () => {
    // Sem material informado (diária à disposição) mas com modo que pede ticket:
    // a conta manda.
    expect(exigeFotoDaViagem({ contaExige: true })).toBe(true);
  });
});

describe("resolverJustificativaSemFoto", () => {
  it("com foto, não há falta a explicar", () => {
    expect(resolverJustificativaSemFoto(true, true, undefined)).toBe(null);
    expect(resolverJustificativaSemFoto(true, true, "qualquer coisa")).toBe(null);
  });

  it("conta não exige: viagem sem foto segue limpa, como sempre foi", () => {
    expect(resolverJustificativaSemFoto(false, false, undefined)).toBe(null);
  });

  it("exige e o motorista explicou: guarda o texto dele", () => {
    expect(
      resolverJustificativaSemFoto(true, false, "O papel ficou na portaria"),
    ).toBe("O papel ficou na portaria");
  });

  it("exige e ninguém explicou: carimba pro painel cobrar (nunca deixa em branco)", () => {
    expect(resolverJustificativaSemFoto(true, false, undefined)).toBe(SEM_JUSTIFICATIVA);
    expect(resolverJustificativaSemFoto(true, false, "   ")).toBe(SEM_JUSTIFICATIVA);
  });
});
