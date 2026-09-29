import { describe, expect, it } from "vitest";
import { diaDaPerguntaDeTeste, ehPerguntaDeTeste, mascararTelefone } from "./conferencia-teste";

const SEG_A_SEX = { diasConsiderados: [1, 2, 3, 4, 5], ignorarFeriados: true };

describe("diaDaPerguntaDeTeste", () => {
  it("sem configuração da empresa: ontem, mesmo domingo", () => {
    expect(diaDaPerguntaDeTeste("2026-09-28", null, null)).toBe("2026-09-27");
  });
  it("com configuração: o último dia ESPERADO antes de hoje (segunda -> sexta)", () => {
    expect(diaDaPerguntaDeTeste("2026-09-28", SEG_A_SEX, new Set())).toBe("2026-09-25");
    expect(diaDaPerguntaDeTeste("2026-09-29", SEG_A_SEX, new Set())).toBe("2026-09-28");
  });
  it("pula feriado nacional só se a empresa ignora feriados", () => {
    const feriados = new Set(["2026-09-28"]);
    expect(diaDaPerguntaDeTeste("2026-09-29", SEG_A_SEX, feriados)).toBe("2026-09-25");
    expect(diaDaPerguntaDeTeste("2026-09-29", { ...SEG_A_SEX, ignorarFeriados: false }, feriados)).toBe("2026-09-28");
  });
  it("config sem nenhum dia considerado: cai em ontem", () => {
    expect(diaDaPerguntaDeTeste("2026-09-28", { diasConsiderados: [], ignorarFeriados: true }, null)).toBe("2026-09-27");
  });
});

describe("ehPerguntaDeTeste", () => {
  it("só o snapshot marcado é teste; linha antiga, nulo e lixo não", () => {
    expect(ehPerguntaDeTeste({ origem: "TESTE_PAINEL" })).toBe(true);
    expect(ehPerguntaDeTeste({ evidencias: {} })).toBe(false);
    expect(ehPerguntaDeTeste(null)).toBe(false);
    expect(ehPerguntaDeTeste("TESTE_PAINEL")).toBe(false);
  });
});

describe("mascararTelefone", () => {
  it("mostra só os 4 últimos dígitos", () => {
    expect(mascararTelefone("5542991088125")).toBe("••••-8125");
    expect(mascararTelefone("12")).toBe("••••");
  });
});
