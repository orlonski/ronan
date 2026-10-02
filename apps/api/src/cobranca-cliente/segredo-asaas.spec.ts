import { describe, expect, it } from "vitest";
import { cifrar } from "../common/cripto";
import {
  cifrarChaveAsaas,
  decifrarChaveAsaas,
  finalDaChave,
  hashTokenWebhook,
  novoTokenWebhook,
  tokenWebhookConfere,
} from "./segredo-asaas";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!";
const CHAVE = "$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjQ";

describe("a chave do Asaas no banco", () => {
  it("vai e volta", () => {
    expect(decifrarChaveAsaas(cifrarChaveAsaas(CHAVE, SEGREDO), SEGREDO)).toBe(CHAVE);
  });

  it("o cifrado não carrega a chave", () => {
    const c = cifrarChaveAsaas(CHAVE, SEGREDO);
    expect(c).not.toContain("aact");
    expect(c.startsWith("v1:")).toBe(true);
  });

  it("segredo errado não decifra", () => {
    expect(decifrarChaveAsaas(cifrarChaveAsaas(CHAVE, SEGREDO), "outro-segredo-qualquer-de-32-chars")).toBeNull();
  });

  it("valor em claro no banco é recusado (a coluna nasceu cifrada)", () => {
    expect(decifrarChaveAsaas(CHAVE, SEGREDO)).toBeNull();
  });

  it("finalidade separada: o cifrado das chaves de IA não abre aqui", () => {
    expect(decifrarChaveAsaas(cifrar(CHAVE, SEGREDO), SEGREDO)).toBeNull();
  });

  it("só os 4 últimos voltam pra tela", () => {
    expect(finalDaChave(CHAVE)).toBe("6OjQ");
  });
});

describe("o token do webhook", () => {
  it("guardado como hash, conferido em tempo constante", () => {
    const token = novoTokenWebhook();
    expect(token.length).toBeGreaterThanOrEqual(32);
    const hash = hashTokenWebhook(token);
    expect(hash).not.toContain(token);
    expect(tokenWebhookConfere(token, hash)).toBe(true);
  });

  it("token errado, vazio ou de outra conta não passa", () => {
    const hashA = hashTokenWebhook(novoTokenWebhook());
    const tokenB = novoTokenWebhook();
    expect(tokenWebhookConfere(tokenB, hashA)).toBe(false);
    expect(tokenWebhookConfere("", hashA)).toBe(false);
    expect(tokenWebhookConfere(undefined, hashA)).toBe(false);
    expect(tokenWebhookConfere(tokenB, null)).toBe(false);
    expect(tokenWebhookConfere(tokenB, "curto")).toBe(false);
  });

  it("dois tokens novos nunca são iguais", () => {
    expect(novoTokenWebhook()).not.toBe(novoTokenWebhook());
  });
});
