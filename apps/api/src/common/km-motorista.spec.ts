import { describe, it, expect } from "vitest";
import { checarAlteracaoKm, fmtKmBr } from "./km-motorista";

// Decimal do Prisma chega como objeto com toString() — o mock imita isso.
const dec = (v: string) => ({ toString: () => v });

describe("checarAlteracaoKm", () => {
  it("não mexer no km não exige nada", () => {
    const r = checarAlteracaoKm({ km: dec("64.00"), kmMotorista: dec("64.00") }, undefined, null);
    expect(r).toEqual({ mudou: false });
  });

  it("mandar o mesmo km (Decimal vs number) não conta como alteração", () => {
    const r = checarAlteracaoKm({ km: dec("64.00"), kmMotorista: dec("64.00") }, 64, null);
    expect(r).toEqual({ mudou: false });
  });

  it("alterar o km do motorista sem motivo é recusado, com o valor dele na mensagem", () => {
    const r = checarAlteracaoKm({ km: dec("64.00"), kmMotorista: dec("64.00") }, 62.8, null);
    expect(r.mudou).toBe(true);
    expect(r.mudou && r.erro).toContain("64 km");
  });

  it("motivo só de espaço não vale por motivo", () => {
    const r = checarAlteracaoKm({ km: dec("64.00"), kmMotorista: dec("64.00") }, 62.8, "   ");
    expect(r.mudou && r.erro).toBeTruthy();
  });

  it("com motivo escrito a alteração passa", () => {
    const r = checarAlteracaoKm(
      { km: dec("640.00"), kmMotorista: dec("640.00") },
      64,
      "Digitou 640 em vez de 64 — confirmado com ele por telefone.",
    );
    expect(r).toEqual({ mudou: true, erro: null });
  });

  it("a lei continua sendo o km do motorista mesmo depois de já terem alterado", () => {
    // km já foi mexido antes (62,8), mas kmMotorista guarda o 64 original: uma
    // segunda alteração continua exigindo motivo.
    const r = checarAlteracaoKm({ km: dec("62.80"), kmMotorista: dec("64.00") }, 60, null);
    expect(r.mudou && r.erro).toContain("64 km");
  });

  it("viagem sem km do motorista (nada lançado pelo app) não exige motivo", () => {
    const r = checarAlteracaoKm({ km: dec("64.00"), kmMotorista: null }, 62.8, null);
    expect(r).toEqual({ mudou: true, erro: null });
  });

  it("viagem que ainda não tem km (diária) aceita o primeiro valor", () => {
    const r = checarAlteracaoKm({ km: null, kmMotorista: null }, 64, null);
    expect(r).toEqual({ mudou: true, erro: null });
  });
});

describe("fmtKmBr", () => {
  it("inteiro sai sem casas; quebrado sai com vírgula", () => {
    expect(fmtKmBr(64)).toBe("64");
    expect(fmtKmBr(64.5)).toBe("64,5");
    expect(fmtKmBr(62.8)).toBe("62,8");
  });
});
