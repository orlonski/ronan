import { describe, expect, it } from "vitest";
import { acrescentarNaTrilha, lerTrilha, novoEvento } from "./conferencia-trilha";

describe("trilha da conferência", () => {
  it("acrescenta em ordem e guarda só os N mais recentes", () => {
    let t: unknown = [];
    for (let i = 0; i < 25; i++) t = acrescentarNaTrilha(t, novoEvento("TOQUE", { i }), 20);
    const l = t as { detalhe: { i: number } }[];
    expect(l).toHaveLength(20);
    expect(l[0]!.detalhe.i).toBe(5);
    expect(l[19]!.detalhe.i).toBe(24);
  });

  it("linha antiga (sem trilha) ou coluna com lixo lê como vazia", () => {
    expect(lerTrilha(null)).toEqual([]);
    expect(lerTrilha({})).toEqual([]);
    expect(lerTrilha([1, null, { em: "x" }, { em: "2026-09-29T12:00:00Z", evento: "ENVIO", detalhe: {} }])).toHaveLength(1);
  });
});
