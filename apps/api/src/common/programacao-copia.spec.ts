import { describe, expect, it } from "vitest";
import { planejarCopia, type PlanejadaOrigem } from "./programacao-copia";

const p = (id: string, over: Partial<PlanejadaOrigem> = {}): PlanejadaOrigem => ({
  id,
  pedidoId: "ped1",
  motoristaId: "m1",
  veiculoId: "v1",
  ...over,
});
const ativo = new Map([["ped1", { status: "EM_CURSO", cumprido: false }]]);

describe("planejarCopia", () => {
  it("copia o dia inteiro quando o destino está vazio", () => {
    expect(planejarCopia([p("a"), p("b")], [], ativo).map((x) => x.acao)).toEqual(["COPIA", "COPIA"]);
  });

  it("não dobra o que já está no destino (clicar duas vezes)", () => {
    const r = planejarCopia([p("a"), p("b"), p("c", { motoristaId: "m2" })], [p("x")], ativo);
    expect(r.map((x) => x.acao)).toEqual(["JA_EXISTE", "COPIA", "COPIA"]);
  });

  it("pula pedido cancelado, cumprido ou com o saldo já entregue", () => {
    const pedidos = new Map([
      ["c", { status: "CANCELADO", cumprido: false }],
      ["d", { status: "CUMPRIDO", cumprido: true }],
      ["e", { status: "EM_CURSO", cumprido: true }],
    ]);
    const r = planejarCopia(
      [p("1", { pedidoId: "c" }), p("2", { pedidoId: "d" }), p("3", { pedidoId: "e" }), p("4", { pedidoId: "sumiu" })],
      [],
      pedidos,
    );
    expect(r.every((x) => x.acao === "PEDIDO_ENCERRADO")).toBe(true);
  });

  it("viagem planejada sem pedido copia normalmente", () => {
    expect(planejarCopia([p("a", { pedidoId: null })], [], new Map())[0]!.acao).toBe("COPIA");
  });
});
