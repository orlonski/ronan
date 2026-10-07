import { describe, expect, it } from "vitest";
import { ehRecenteParaProgramacao, POLITICA_DA_ORIGEM } from "./viagem-origem";

describe("efeitos da criação de viagem por origem", () => {
  it("só o app fala com o motorista; a planilha não fala com ninguém", () => {
    expect(POLITICA_DA_ORIGEM.APP.avisarMotorista).toBe(true);
    for (const o of ["IMPORTACAO", "INTEGRACAO", "PAINEL"] as const) expect(POLITICA_DA_ORIGEM[o].avisarMotorista).toBe(false);
    expect(POLITICA_DA_ORIGEM.IMPORTACAO.avisarAdministradores).toBe("nunca");
    expect(POLITICA_DA_ORIGEM.IMPORTACAO.casarProgramacao).toBe("nunca");
  });

  it("a integração não tem o km refeito pela rota (km do sistema dela não vira o do OSRM)", () => {
    expect(POLITICA_DA_ORIGEM.INTEGRACAO.reprocessarKm).toBe(false);
  });

  it("toda origem ganha preço da tabela", () => {
    for (const p of Object.values(POLITICA_DA_ORIGEM)) expect(p.precificar).toBe(true);
  });

  it("programação só casa com viagem de ontem pra cá", () => {
    expect(ehRecenteParaProgramacao("2026-10-06", "2026-10-07")).toBe(true);
    expect(ehRecenteParaProgramacao("2026-10-07", "2026-10-07")).toBe(true);
    expect(ehRecenteParaProgramacao("2026-10-05", "2026-10-07")).toBe(false);
  });
});
