import { describe, it, expect } from "vitest";
import { EscritorioSnapshotSchema } from "@ronan/shared-types";
import {
  montarSnapshotEscritorio,
  JANELA_EVENTOS_MS,
  LIMITE_EVENTOS,
  type EntradaSnapshot,
} from "./escritorio-snapshot";

const AGORA = new Date("2026-10-20T15:00:00.000Z");
const atras = (ms: number) => new Date(AGORA.getTime() - ms);

const VAZIO: EntradaSnapshot = {
  agora: AGORA,
  robo: { ativo: true, modoSombra: true },
  fila: 0,
  validadas24h: 0,
  devolvidas: 0,
  ajustadas: 0,
  travadas: 0,
  travadaMaisAntigaDesde: null,
  chegadas: [],
  veredictos: [],
};

describe("montarSnapshotEscritorio", () => {
  it("vazio: zeros, sem eventos e válido no contrato", () => {
    const s = montarSnapshotEscritorio(VAZIO);
    expect(EscritorioSnapshotSchema.parse(s)).toEqual(s);
    expect(s.contagens).toEqual({ fila: 0, validadas24h: 0, devolvidas: 0, ajustadas: 0, travadas: 0 });
    expect(s.travadaMaisAntigaMin).toBeNull();
    expect(s.chegadas).toEqual([]);
    expect(s.veredictos).toEqual([]);
  });

  it("travada antiga: idade em minutos inteiros", () => {
    const s = montarSnapshotEscritorio({ ...VAZIO, travadas: 2, travadaMaisAntigaDesde: atras(195 * 60_000 + 30_000) });
    expect(s.travadaMaisAntigaMin).toBe(195);
  });

  it("sem travadas a idade é null, mesmo que haja uma data sobrando", () => {
    const s = montarSnapshotEscritorio({ ...VAZIO, travadas: 0, travadaMaisAntigaDesde: atras(60_000) });
    expect(s.travadaMaisAntigaMin).toBeNull();
  });

  it("travada sem leitura registrada não inventa idade", () => {
    const s = montarSnapshotEscritorio({ ...VAZIO, travadas: 1, travadaMaisAntigaDesde: null });
    expect(s.travadaMaisAntigaMin).toBeNull();
  });

  it("janela de tempo: evento fora dos 10 min não entra, o da borda entra", () => {
    const s = montarSnapshotEscritorio({
      ...VAZIO,
      chegadas: [
        { id: "velha", em: atras(JANELA_EVENTOS_MS + 1) },
        { id: "borda", em: atras(JANELA_EVENTOS_MS) },
        { id: "nova", em: atras(1000) },
      ],
    });
    expect(s.chegadas.map((c) => c.id)).toEqual(["nova", "borda"]);
  });

  it("limite de 50, mais recentes primeiro", () => {
    const chegadas = Array.from({ length: 80 }, (_, i) => ({ id: `v${i}`, em: atras(i * 1000) }));
    const s = montarSnapshotEscritorio({ ...VAZIO, chegadas });
    expect(s.chegadas).toHaveLength(LIMITE_EVENTOS);
    expect(s.chegadas[0].id).toBe("v0");
    expect(s.chegadas[49].id).toBe("v49");
    expect(EscritorioSnapshotSchema.parse(s)).toBeTruthy();
  });

  it("veredito: segunda leitura quando passou de 1 passada ou escalou", () => {
    const base = { viagemId: "x", em: atras(1000), veredito: "DIVERGE" as const, acao: "AVISOU_MOTORISTA" };
    const s = montarSnapshotEscritorio({
      ...VAZIO,
      veredictos: [
        { ...base, id: "a", passadas: 1, escalouEm: null },
        { ...base, id: "b", em: atras(2000), passadas: 2, escalouEm: null },
        { ...base, id: "c", em: atras(3000), passadas: 1, escalouEm: atras(3500) },
      ],
    });
    expect(s.veredictos.map((v) => [v.id, v.segundaLeitura])).toEqual([["a", false], ["b", true], ["c", true]]);
    expect(EscritorioSnapshotSchema.parse(s)).toBeTruthy();
  });

  it("repassa o modo do robô (sombra tem que aparecer)", () => {
    const s = montarSnapshotEscritorio({ ...VAZIO, robo: { ativo: false, modoSombra: true } });
    expect(s.robo).toEqual({ ativo: false, modoSombra: true });
  });
});
