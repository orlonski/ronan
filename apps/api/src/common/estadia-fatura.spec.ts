import { describe, expect, it } from "vitest";
import { estadiasCobraveis, type EventoParaEstadia } from "./estadia-fatura";

const e = (over: Partial<EventoParaEstadia>): EventoParaEstadia => ({
  id: "e1",
  viagemId: "v1",
  tipoNome: "Fila na obra",
  geraCobranca: true,
  valorHora: 120,
  iniciouEm: new Date("2026-09-10T12:00:00Z"),
  terminouEm: new Date("2026-09-10T14:40:00Z"),
  jaFaturado: false,
  ...over,
});

describe("estadiasCobraveis", () => {
  it("parada encerrada com valor/hora vira cobrança (hora começada conta inteira)", () => {
    expect(estadiasCobraveis([e({})])).toEqual([
      { eventoId: "e1", viagemId: "v1", tipoNome: "Fila na obra", horas: 3, horasCobradas: 3, valorHora: "120.00", valor: "360.00" },
    ]);
  });

  it("aberta, já faturada, sem valor/hora ou que não gera cobrança fica de fora", () => {
    expect(
      estadiasCobraveis([
        e({ id: "a", terminouEm: null }),
        e({ id: "b", jaFaturado: true }),
        e({ id: "c", valorHora: null }),
        e({ id: "d", geraCobranca: false }),
        e({ id: "f", iniciouEm: null }),
      ]),
    ).toEqual([]);
  });
});
