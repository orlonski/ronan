import { describe, expect, it } from "vitest";
import { caminhoesSemChecklist, descricaoDoAviso, diaBR } from "./checklist";

describe("checklist", () => {
  it("dia de Brasília: 01h UTC ainda é o dia anterior", () => {
    expect(diaBR(new Date("2026-10-02T01:00:00Z"))).toBe("2026-10-01");
  });

  it("lista caminhão que rodou sem checklist no dia; checklist de outro motorista vale pro caminhão", () => {
    const r = caminhoesSemChecklist(
      [
        { veiculoId: "a", placa: "AAA1A11", motorista: "João", quando: new Date("2026-10-01T11:00:00Z") },
        { veiculoId: "a", placa: "AAA1A11", motorista: "Zé", quando: new Date("2026-10-01T20:00:00Z") },
        { veiculoId: "b", placa: "BBB2B22", motorista: "Pedro", quando: new Date("2026-10-01T11:00:00Z") },
        { veiculoId: "b", placa: "BBB2B22", motorista: "Pedro", quando: new Date("2026-10-02T11:00:00Z") },
      ],
      [
        { veiculoId: "b", feitoEm: new Date("2026-10-01T10:00:00Z") },
        { veiculoId: null, feitoEm: new Date("2026-10-02T10:00:00Z") },
      ],
    );
    expect(r).toEqual([
      { veiculoId: "b", placa: "BBB2B22", dia: "2026-10-02", motoristas: ["Pedro"] },
      { veiculoId: "a", placa: "AAA1A11", dia: "2026-10-01", motoristas: ["João", "Zé"] },
    ]);
  });

  it("descrição do aviso leva o item e a observação", () => {
    expect(descricaoDoAviso("Pneus", " traseiro careca ")).toBe("Checklist: Pneus — traseiro careca");
    expect(descricaoDoAviso("Freios", null)).toBe("Checklist: Freios");
  });
});
