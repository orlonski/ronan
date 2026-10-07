import { describe, expect, it } from "vitest";
import { TentativasDeLogin } from "./tentativas-de-login";

const MIN = 60_000;
const novo = () => new TentativasDeLogin({ maxFalhas: 10, janelaMs: 15 * MIN, bloqueioMs: 15 * MIN });

describe("freio de tentativas de login", () => {
  it("10 senhas erradas em 15 min bloqueiam o e-mail por 15 min", () => {
    const t = novo();
    for (let i = 0; i < 9; i++) expect(t.falhou("a@x.com", i * 1000)).toBe(false);
    expect(t.falhou("a@x.com", 9_000)).toBe(true);
    expect(t.bloqueada("a@x.com", 10_000)).toBe(15);
    expect(t.bloqueada("a@x.com", 9_000 + 15 * MIN + 1)).toBeNull();
  });

  it("erros espalhados além da janela não bloqueiam", () => {
    const t = novo();
    for (let i = 0; i < 20; i++) expect(t.falhou("a@x.com", i * 2 * MIN)).toBe(false);
  });

  it("login certo zera a contagem; o bloqueio é por e-mail", () => {
    const t = novo();
    for (let i = 0; i < 9; i++) t.falhou("a@x.com", i);
    t.acertou("a@x.com");
    expect(t.falhou("a@x.com", 100)).toBe(false);
    for (let i = 0; i < 10; i++) t.falhou("b@x.com", i);
    expect(t.bloqueada("b@x.com", 20)).not.toBeNull();
    expect(t.bloqueada("a@x.com", 20)).toBeNull();
  });
});
