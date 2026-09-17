import { describe, expect, it } from "vitest";
import { cifrar, decifrar, estaCifrado } from "./cripto";

const SEGREDO = "segredo-de-teste-que-ninguem-usa-em-producao";

describe("cifra das chaves de IA", () => {
  it("vai e volta", () => {
    const chave = "sk-ant-api03-" + "x".repeat(80);
    expect(decifrar(cifrar(chave, SEGREDO), SEGREDO)).toBe(chave);
  });

  it("o texto cifrado não contém o valor original", () => {
    const chave = "MiniMax-chave-secreta-123456";
    expect(cifrar(chave, SEGREDO)).not.toContain("secreta");
  });

  it("cifrar duas vezes dá resultados diferentes (IV novo a cada vez)", () => {
    const a = cifrar("mesma-chave", SEGREDO);
    const b = cifrar("mesma-chave", SEGREDO);
    expect(a).not.toBe(b);
    expect(decifrar(a, SEGREDO)).toBe(decifrar(b, SEGREDO));
  });

  it("segredo errado não decifra — e não devolve lixo", () => {
    expect(decifrar(cifrar("abc", SEGREDO), "outro-segredo")).toBeNull();
  });

  it("valor adulterado no banco falha em vez de passar", () => {
    const bom = cifrar("abc", SEGREDO);
    const ruim = bom.slice(0, -4) + "AAAA";
    expect(decifrar(ruim, SEGREDO)).toBeNull();
  });

  it("valor antigo em claro continua funcionando", () => {
    // Compat: o que foi gravado antes desta função existir.
    expect(decifrar("chave-em-claro-antiga", SEGREDO)).toBe("chave-em-claro-antiga");
  });

  it("vazio é nulo", () => {
    expect(decifrar("", SEGREDO)).toBeNull();
    expect(decifrar(null, SEGREDO)).toBeNull();
  });

  it("reconhece o que já está cifrado", () => {
    expect(estaCifrado(cifrar("x", SEGREDO))).toBe(true);
    expect(estaCifrado("sk-ant-123")).toBe(false);
  });
});
