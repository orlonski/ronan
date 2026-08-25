import { describe, it, expect } from "vitest";
import { ClienteIaFactory, ProvedorIaNaoConfigurado } from "./cliente-ia";
import { BASE_URL_MINIMAX } from "../common/ia/provedor-ia";
import type { ConfigService } from "@nestjs/config";

const config = (chaves: Record<string, string | undefined>) =>
  ({ get: (c: string) => chaves[c] }) as unknown as ConfigService;

/** O SDK expõe a base URL resolvida; é o que prova o roteamento. */
const baseUrl = (c: { baseURL?: string }) => c.baseURL;

describe("ClienteIaFactory", () => {
  it("manda modelo do MiniMax pro endpoint compatível deles", () => {
    const f = new ClienteIaFactory(config({ MINIMAX_API_KEY: "mm-x" }));
    expect(baseUrl(f.para("MiniMax-M3"))).toBe(BASE_URL_MINIMAX);
  });

  it("modelo da Anthropic vai pro endpoint padrão do SDK", () => {
    const f = new ClienteIaFactory(config({ ANTHROPIC_API_KEY: "sk-ant-x" }));
    expect(baseUrl(f.para("claude-opus-5"))).toContain("anthropic.com");
  });

  it("MINIMAX_BASE_URL sobrescreve — existe endpoint separado pra China", () => {
    const f = new ClienteIaFactory(
      config({ MINIMAX_API_KEY: "mm-x", MINIMAX_BASE_URL: "https://api.minimaxi.com/anthropic" }),
    );
    expect(baseUrl(f.para("MiniMax-M3"))).toBe("https://api.minimaxi.com/anthropic");
  });

  it("reaproveita o cliente por FORNECEDOR, não por modelo", () => {
    const f = new ClienteIaFactory(config({ ANTHROPIC_API_KEY: "sk-ant-x" }));
    // O modelo vai no corpo do request; dois modelos do mesmo fornecedor não
    // justificam duas conexões.
    expect(f.para("claude-opus-5")).toBe(f.para("claude-haiku-4-5-20251001"));
  });

  it("falta de chave é erro nomeado, não cliente undefined três frames adiante", () => {
    const f = new ClienteIaFactory(config({ ANTHROPIC_API_KEY: "sk-ant-x" }));
    expect(() => f.para("MiniMax-M3")).toThrow(ProvedorIaNaoConfigurado);
    expect(() => f.para("MiniMax-M3")).toThrow(/MINIMAX_API_KEY/);
  });

  it("disponivel responde pelo fornecedor daquele modelo", () => {
    const f = new ClienteIaFactory(config({ MINIMAX_API_KEY: "mm-x" }));
    expect(f.disponivel("MiniMax-M3")).toBe(true);
    expect(f.disponivel("claude-opus-5")).toBe(false);
    // O worker consome a fila se QUALQUER fornecedor estiver de pé.
    expect(f.algumProvedorConfigurado).toBe(true);
  });

  it("chave só de espaço não conta como configurada", () => {
    const f = new ClienteIaFactory(config({ MINIMAX_API_KEY: "   " }));
    expect(f.algumProvedorConfigurado).toBe(false);
  });
});
