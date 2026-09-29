import { describe, expect, it } from "vitest";
import { JANELA_PERGUNTA_DE_TESTE_DIAS } from "@ronan/shared-types";
import { diaDaPerguntaDeTeste, ehPerguntaDeTeste, mascararTelefone, motivoDiaDeTesteInvalido } from "./conferencia-teste";

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

describe("motivoDiaDeTesteInvalido", () => {
  const HOJE = "2026-09-28";
  it("aceita ontem, a semana passada e o limite exato da janela", () => {
    expect(motivoDiaDeTesteInvalido("2026-09-27", HOJE)).toBeNull();
    expect(motivoDiaDeTesteInvalido("2026-09-22", HOJE)).toBeNull();
    expect(motivoDiaDeTesteInvalido("2026-07-30", HOJE)).toBeNull(); // 60 dias antes
    expect(JANELA_PERGUNTA_DE_TESTE_DIAS).toBe(60);
  });
  it("recusa hoje e futuro", () => {
    expect(motivoDiaDeTesteInvalido("2026-09-28", HOJE)).toMatch(/já passou/);
    expect(motivoDiaDeTesteInvalido("2026-09-29", HOJE)).toMatch(/já passou/);
    expect(motivoDiaDeTesteInvalido("2027-01-01", HOJE)).toMatch(/já passou/);
  });
  it("recusa velho demais (61 dias)", () => {
    expect(motivoDiaDeTesteInvalido("2026-07-29", HOJE)).toMatch(/antigo demais/);
  });
  it("recusa formato inválido e data que não existe", () => {
    for (const ruim of ["", "hoje", "28/09/2026", "2026-9-1", "2026-02-30", "2026-13-01", "2026-09-31", "20260927"]) {
      expect(motivoDiaDeTesteInvalido(ruim, HOJE), ruim).toMatch(/Data inválida/);
    }
  });
});
