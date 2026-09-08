import { describe, expect, it } from "vitest";
import { nasceComoConvite, vinculoVivo } from "./vinculo";

describe("quando a empresa digita um CPF", () => {
  it("pessoa que usa o app é CONVIDADA — ela decide se entra", () => {
    expect(nasceComoConvite({ ultimoLoginEm: new Date("2026-09-01") })).toBe(true);
  });

  it("pessoa que nunca entrou no app é CADASTRADA — não há quem responda", () => {
    // Convite aqui ficaria pendurado pra sempre: ela não tem como ver. Ela
    // assume o cadastro quando baixar o app (reivindicação).
    expect(nasceComoConvite({ ultimoLoginEm: null })).toBe(false);
  });

  it("CPF que não existe na plataforma é cadastro novo", () => {
    expect(nasceComoConvite(null)).toBe(false);
  });
});

describe("vínculo vivo", () => {
  const base = { ativo: true, status: "APROVADO" as const, aceite: "ACEITO" as const };

  it("só vale com os dois lados verdes", () => {
    expect(vinculoVivo(base)).toBe(true);
    expect(vinculoVivo({ ...base, aceite: "PENDENTE" })).toBe(false);
    expect(vinculoVivo({ ...base, aceite: "RECUSADO" })).toBe(false);
    expect(vinculoVivo({ ...base, status: "REJEITADO" })).toBe(false);
    expect(vinculoVivo({ ...base, ativo: false })).toBe(false);
  });

  it("cadastro em análise continua valendo — o app mostra o modo 'em análise'", () => {
    expect(vinculoVivo({ ...base, status: "PENDENTE_APROVACAO" })).toBe(true);
  });
});
