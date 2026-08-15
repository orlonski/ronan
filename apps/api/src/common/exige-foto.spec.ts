import { describe, it, expect } from "vitest";
import {
  exigeFotoDaViagem,
  fotosExigidasAtendidas,
  resolverFotosExigidas,
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

describe("resolverFotosExigidas", () => {
  const nada = { cupom: false, odometro: false, bomba: false };

  it("sem modalidade e conta sem cupom: não exige nada (o padrão de hoje)", () => {
    expect(resolverFotosExigidas(null, false)).toEqual(nada);
  });

  it("sem modalidade: vale só o cupom da conta — odômetro/bomba nem existem", () => {
    expect(resolverFotosExigidas(null, true)).toEqual({
      cupom: true,
      odometro: false,
      bomba: false,
    });
  });

  it("o exemplo do Diego: agregado só odômetro", () => {
    const agregado = { exigeFotoCupom: false, exigeFotoOdometro: true, exigeFotoBomba: false };
    expect(resolverFotosExigidas(agregado, true)).toEqual({
      cupom: false,
      odometro: true,
      bomba: false,
    });
  });

  it("o exemplo do Diego: terceiro pede odômetro e bomba", () => {
    const terceiro = { exigeFotoCupom: false, exigeFotoOdometro: true, exigeFotoBomba: true };
    expect(resolverFotosExigidas(terceiro, true)).toEqual({
      cupom: false,
      odometro: true,
      bomba: true,
    });
  });

  it("o exemplo do Diego: própria não pede nada, MESMO com o cupom ligado na conta", () => {
    const propria = { exigeFotoCupom: false, exigeFotoOdometro: false, exigeFotoBomba: false };
    expect(resolverFotosExigidas(propria, true)).toEqual(nada);
  });

  it("modalidade pode exigir o cupom sem a conta exigir", () => {
    const m = { exigeFotoCupom: true, exigeFotoOdometro: false, exigeFotoBomba: false };
    expect(resolverFotosExigidas(m, false).cupom).toBe(true);
  });
});

describe("fotosExigidasAtendidas", () => {
  it("nada exigido: qualquer coisa serve", () => {
    expect(fotosExigidasAtendidas({ cupom: false, odometro: false, bomba: false }, [])).toBe(true);
  });

  it("cobre o que foi pedido", () => {
    const e = { cupom: true, odometro: true, bomba: false };
    expect(fotosExigidasAtendidas(e, ["CUPOM", "ODOMETRO"])).toBe(true);
    expect(fotosExigidasAtendidas(e, ["CUPOM", "ODOMETRO", "BOMBA"])).toBe(true);
  });

  it("mandar a foto errada não conta — é cobertura, não quantidade", () => {
    const e = { cupom: false, odometro: true, bomba: false };
    expect(fotosExigidasAtendidas(e, ["BOMBA"])).toBe(false);
    expect(fotosExigidasAtendidas(e, ["CUPOM", "BOMBA"])).toBe(false);
  });

  it("faltando uma das exigidas, reprova", () => {
    const e = { cupom: true, odometro: true, bomba: true };
    expect(fotosExigidasAtendidas(e, ["CUPOM", "ODOMETRO"])).toBe(false);
  });
});
