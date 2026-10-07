import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { TagProcessamentoService } from "./tag-processamento.service";

const svc = new TagProcessamentoService(null as never, null as never, null as never, null as never, null as never);
const passagem = (hora: string, valor: string, extra: Record<string, unknown> = {}) => ({
  chavePraca: "BR364|383100",
  ocorridoEm: new Date(`2026-09-13T${hora}:00Z`),
  eixosCobrados: 7,
  dc: "D",
  valor: new Prisma.Decimal(valor),
  rodovia: "BR364",
  kmMetros: 383100,
  cidade: "SANTO ANTONIO LEVERGER",
  concessionaria: "NOVA ROTA DO OESTE",
  uf: "MT",
  ...extra,
});

describe("tarifa observada na fatura", () => {
  it("passagem paga pelo vale (R$ 0,00 na tag) não vira tarifa zero", () => {
    const [p] = svc.pracasDasPassagens([passagem("10:00", "42.00"), passagem("20:00", "0.00")] as never);
    expect(p!.tarifaEixoCent).toBe(600);
    expect(p!.tarifaEm?.toISOString()).toBe("2026-09-13T10:00:00.000Z");
  });

  it("a tarifa é a da cobrança mais recente", () => {
    const [p] = svc.pracasDasPassagens([passagem("10:00", "42.00"), passagem("15:00", "44.10")] as never);
    expect(p!.tarifaEixoCent).toBe(630);
  });

  it("só passagem com vale: sem tarifa", () => {
    const [p] = svc.pracasDasPassagens([passagem("10:00", "0.00")] as never);
    expect(p!.tarifaEixoCent).toBeNull();
  });
});
