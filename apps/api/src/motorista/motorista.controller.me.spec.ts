import { describe, expect, it, vi } from "vitest";
import { MotoristaController } from "./motorista.controller";

describe("GET /m/me e o lembrete de lançamento (retrocompatível)", () => {
  const perfil = { id: "m1", nome: "João" };
  const user = { id: "m1" } as never;

  it("sem lembrete: a resposta é IDÊNTICA à de antes (nenhuma chave nova) — app antigo não vê diferença", async () => {
    const c = new MotoristaController(
      { me: vi.fn(async () => perfil) } as never,
      { paraMotorista: vi.fn(async () => null) } as never,
    );
    const r = await c.me(user);
    expect(r).toEqual(perfil);
    expect("lembreteLancamento" in r).toBe(false);
  });

  it("com lembrete: vai como campo extra, o resto do perfil intacto", async () => {
    const l = { dias: 3, desde: "2026-09-23", calculadoEm: "2026-09-28" };
    const c = new MotoristaController(
      { me: vi.fn(async () => perfil) } as never,
      { paraMotorista: vi.fn(async () => l) } as never,
    );
    expect(await c.me(user)).toEqual({ ...perfil, lembreteLancamento: l });
  });
});
