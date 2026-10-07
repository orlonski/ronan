import { describe, expect, it } from "vitest";
import { CHAVE_NO_TEXTO, formatoDeChaveValido, gerarChave, hashDaChave, partesVisiveis } from "./chave";
import { mascararTexto } from "../common/chamadas-externas/registro";

describe("chave de integração", () => {
  it("nasce no formato, com o CRC conferindo, e cada uma é diferente", () => {
    const a = gerarChave();
    const b = gerarChave();
    expect(a).toMatch(/^mvt_live_[0-9A-Za-z]{49}$/);
    expect(formatoDeChaveValido(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashDaChave(a)).toHaveLength(64);
  });

  it("um caractere trocado é recusado sem ir ao banco (CRC)", () => {
    const a = gerarChave();
    const i = 20;
    const trocada = a.slice(0, i) + (a[i] === "A" ? "B" : "A") + a.slice(i + 1);
    expect(formatoDeChaveValido(trocada)).toBe(false);
    expect(formatoDeChaveValido("eyJhbGciOiJIUzI1NiJ9.x.y")).toBe(false);
    expect(formatoDeChaveValido("obra_" + "a".repeat(40))).toBe(false);
  });

  it("a tela mostra só o começo e o fim", () => {
    const { inicio, final } = partesVisiveis(gerarChave());
    expect(inicio).toMatch(/^mvt_live_.{4}$/);
    expect(final).toHaveLength(4);
  });

  it("a chave some de qualquer texto que vá pra log", () => {
    const a = gerarChave();
    expect(`erro com ${a} no meio`.match(CHAVE_NO_TEXTO)).toEqual([a]);
    expect(mascararTexto(`{"chave":"${a}"}`)).not.toContain(a.slice(9));
  });
});
