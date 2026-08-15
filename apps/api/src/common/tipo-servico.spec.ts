import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { MODO_CLASSICO, resolverPeriodo, type ModoServico } from "./tipo-servico";

const DIARIA: ModoServico = {
  id: "t1",
  medicao: "PERIODO",
  exigeMaterial: false,
  exigeTicket: false,
  exigeLocalDescarga: false,
  exigeKm: false,
};

const d = (iso: string) => new Date(iso);

describe("resolverPeriodo", () => {
  it("modo por peso ignora entrada/saída mandadas por engano", () => {
    const r = resolverPeriodo(MODO_CLASSICO, {
      entradaEm: d("2026-08-14T10:00:00Z"),
      saidaEm: d("2026-08-14T18:00:00Z"),
    });
    expect(r).toEqual({
      entradaEm: null,
      saidaEm: null,
      duracaoMinutos: null,
      aguardandoSaida: false,
    });
  });

  it("diária fechada calcula a duração", () => {
    const r = resolverPeriodo(DIARIA, {
      entradaEm: d("2026-08-14T10:00:00Z"),
      saidaEm: d("2026-08-14T14:20:00Z"),
    });
    expect(r.duracaoMinutos).toBe(260);
    expect(r.aguardandoSaida).toBe(false);
  });

  it("diária sem saída fica aberta — é estado normal, não erro", () => {
    const r = resolverPeriodo(DIARIA, { entradaEm: d("2026-08-14T10:00:00Z") });
    expect(r.aguardandoSaida).toBe(true);
    expect(r.duracaoMinutos).toBe(null);
  });

  it("virada da noite (22h→06h) dá duração positiva", () => {
    const r = resolverPeriodo(DIARIA, {
      entradaEm: d("2026-08-14T22:00:00Z"),
      saidaEm: d("2026-08-15T06:00:00Z"),
    });
    expect(r.duracaoMinutos).toBe(480);
  });

  it("diária sem entrada é 4xx, não 500 (500 trava o outbox em loop)", () => {
    expect(() => resolverPeriodo(DIARIA, {})).toThrow(BadRequestException);
  });

  it("saída antes da entrada é 4xx", () => {
    expect(() =>
      resolverPeriodo(DIARIA, {
        entradaEm: d("2026-08-14T18:00:00Z"),
        saidaEm: d("2026-08-14T10:00:00Z"),
      }),
    ).toThrow(BadRequestException);
  });

  it("período absurdo (ano digitado errado) é 4xx", () => {
    expect(() =>
      resolverPeriodo(DIARIA, {
        entradaEm: d("2025-08-14T10:00:00Z"),
        saidaEm: d("2026-08-14T10:00:00Z"),
      }),
    ).toThrow(BadRequestException);
  });
});
