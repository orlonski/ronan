import { describe, expect, it } from "vitest";
import { identificarChave } from "./identificar-chave";

describe("identificar chave de API", () => {
  it("mostra prefixo e fim de uma chave da Anthropic", () => {
    const r = identificarChave("sk-ant-api03-" + "a".repeat(80) + "K9fA");
    expect(r).toBe("sk-ant…K9fA");
  });

  it("mostra prefixo e fim de uma chave do Gemini", () => {
    const r = identificarChave("AIzaSy" + "b".repeat(30) + "7xQz");
    expect(r).toBe("AIzaSy…7xQz");
  });

  it("nunca devolve a chave inteira", () => {
    const chave = "sk-ant-api03-" + "c".repeat(90);
    const r = identificarChave(chave) ?? "";
    expect(chave).not.toContain(r);
    expect(r.length).toBeLessThan(15);
  });

  it("chave curta some inteira em vez de virar quase legível", () => {
    expect(identificarChave("abc123")).toBe("••••");
    expect(identificarChave("a".repeat(19))).toBe("••••");
  });

  it("sem chave não inventa apelido", () => {
    expect(identificarChave(null)).toBeNull();
    expect(identificarChave(undefined)).toBeNull();
    expect(identificarChave("   ")).toBeNull();
  });
});
