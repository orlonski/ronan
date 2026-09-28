import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { pedagioPublico } from "./viagem-publica";

const d = (v: string) => new Prisma.Decimal(v);
const linha = (praca: string, valor: string) => ({ pracaPedagio: praca, valor: d(valor), data: new Date("2026-09-09") });

describe("pedágio do comprovante público", () => {
  it("com o total do app, vai só o total — nunca misturado com linhas antigas", () => {
    expect(pedagioPublico({ valorPedagioTotal: d("33.89"), pedagios: [linha("Praça Contorno Sul", "28.68")] })).toEqual({
      total: "33.89",
      itens: [],
    });
  });

  it("sem o total do app, as linhas e a soma DELAS", () => {
    expect(
      pedagioPublico({ valorPedagioTotal: null, pedagios: [linha("A", "10.50"), linha("B", "18.18")] }),
    ).toMatchObject({ total: "28.68", itens: [{ praca: "A", valor: "10.50" }, { praca: "B", valor: "18.18" }] });
  });

  it("sem pedágio nenhum, nada", () => {
    expect(pedagioPublico({ valorPedagioTotal: d("0"), pedagios: [] })).toEqual({ total: null, itens: [] });
  });
});
