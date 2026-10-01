import { describe, expect, it } from "vitest";
import { fasesDaViagem, percentil, resumirCiclo, type EventoCiclo, type ViagemCiclo } from "./ciclo-carga";

const t = (hm: string) => new Date(`2026-09-10T${hm}:00Z`);
const ev = (slug: string, hm: string, over: Partial<EventoCiclo> = {}): EventoCiclo => ({
  slug,
  ehCarga: slug === "cheguei-carga",
  ehDescarga: slug === "cheguei-descarga",
  ocorridoEm: t(hm),
  ...over,
});
const completa = [
  ev("cheguei-carga", "08:00"),
  ev("carreguei", "08:40"),
  ev("sai-carga", "08:50"),
  ev("cheguei-descarga", "09:35"),
  ev("descarreguei", "09:55"),
];

describe("fasesDaViagem", () => {
  it("mede carga, trajeto, descarga e total pelos marcos do app", () => {
    expect(fasesDaViagem(completa)).toEqual({ carga: 50, trajeto: 45, descarga: 20, total: 115 });
  });

  it("marco que falta não vira zero: a fase some", () => {
    expect(fasesDaViagem([ev("cheguei-carga", "08:00"), ev("sai-carga", "08:30")])).toEqual({
      carga: 30,
      trajeto: null,
      descarga: null,
      total: null,
    });
  });

  it("conta que renomeou o evento de chegada ainda mede (ehCarga/ehDescarga)", () => {
    const f = fasesDaViagem([
      ev("chegada-pedreira", "08:00", { ehCarga: true }),
      ev("sai-carga", "08:20"),
      ev("chegada-obra", "09:00", { ehDescarga: true }),
      ev("descarreguei", "09:10"),
    ]);
    expect(f).toEqual({ carga: 20, trajeto: 40, descarga: 10, total: 70 });
  });

  it("casca esquecida aberta (mais de 24h) não entra", () => {
    expect(
      fasesDaViagem([ev("cheguei-carga", "08:00"), ev("sai-carga", "08:30", { ocorridoEm: new Date("2026-09-12T08:00:00Z") })]).carga,
    ).toBeNull();
  });
});

describe("percentil", () => {
  it("mediana e p90", () => {
    expect(percentil([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.5)).toBe(55);
    expect(percentil([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBe(91);
    expect(percentil([], 0.5)).toBeNull();
  });
});

describe("resumirCiclo", () => {
  const v = (id: string, carga: string, descarga: string, eventos: EventoCiclo[]): ViagemCiclo => ({
    id,
    localCarga: { id: carga, nome: `Pedreira ${carga}` },
    localDescarga: { id: descarga, nome: `Obra ${descarga}` },
    eventos,
  });

  it("agrupa por local e põe onde mais se espera primeiro", () => {
    const lenta = [ev("cheguei-carga", "08:00"), ev("sai-carga", "10:00")];
    const rapida = [ev("cheguei-carga", "08:00"), ev("sai-carga", "08:20")];
    const r = resumirCiclo([v("1", "A", "X", rapida), v("2", "B", "X", lenta), v("3", "B", "X", lenta), v("4", "C", "X", [])]);
    expect(r.viagens).toBe(4);
    expect(r.comMarcos).toBe(3);
    expect(r.naCarga.map((l) => [l.nome, l.viagens, l.medianaMin])).toEqual([
      ["Pedreira B", 2, 120],
      ["Pedreira A", 1, 20],
    ]);
  });
});
