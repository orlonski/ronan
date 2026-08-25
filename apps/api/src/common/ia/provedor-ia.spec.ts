import { describe, it, expect } from "vitest";
import { provedorDoModelo, chaveDoProvedor, BASE_URL_MINIMAX } from "./provedor-ia";

describe("provedorDoModelo", () => {
  it("reconhece os modelos da Anthropic que rodam hoje", () => {
    expect(provedorDoModelo("claude-haiku-4-5-20251001")).toBe("anthropic");
    expect(provedorDoModelo("claude-opus-5")).toBe("anthropic");
    expect(provedorDoModelo("claude-sonnet-4-6")).toBe("anthropic");
  });

  it("reconhece o MiniMax pelo prefixo, não por lista de ids", () => {
    // Modelo que ainda não existe tem que resolver certo sem deploy.
    expect(provedorDoModelo("MiniMax-M3")).toBe("minimax");
    expect(provedorDoModelo("MiniMax-M4")).toBe("minimax");
    expect(provedorDoModelo("MiniMax-M3-highspeed")).toBe("minimax");
  });

  it("não se importa com caixa nem com espaço em volta", () => {
    expect(provedorDoModelo("minimax-m3")).toBe("minimax");
    expect(provedorDoModelo("  MINIMAX-M3  ")).toBe("minimax");
  });

  it("id desconhecido cai na Anthropic, que é o caminho de sempre", () => {
    expect(provedorDoModelo("gpt-algum-dia")).toBe("anthropic");
    expect(provedorDoModelo("")).toBe("anthropic");
    // "minimax" sem o hífen não é id de modelo deles — não vale desviar por isso.
    expect(provedorDoModelo("minimaxímetro")).toBe("anthropic");
  });
});

describe("chaveDoProvedor", () => {
  it("aponta a env var de cada um", () => {
    expect(chaveDoProvedor("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(chaveDoProvedor("minimax")).toBe("MINIMAX_API_KEY");
  });
});

describe("BASE_URL_MINIMAX", () => {
  it("termina em /anthropic — é o endpoint compatível, não a API nativa deles", () => {
    expect(BASE_URL_MINIMAX.endsWith("/anthropic")).toBe(true);
  });
});
