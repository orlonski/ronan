import { describe, expect, it } from "vitest";
import { precisaCalcularRota, previsaoChegada, type EntradaPrevisao } from "./previsao-chegada";

const agora = new Date("2026-10-01T16:00:00Z"); // 13h00 em Brasília
// Curitiba → Ponta Grossa.
const destino = { nome: "Obra Ponta Grossa", lat: -25.09, lng: -50.16 };
const posicaoLonge = { lat: -25.43, lng: -49.27, capturadoEm: new Date("2026-10-01T15:55:00Z") };

function entrada(over: Partial<EntradaPrevisao> = {}): EntradaPrevisao {
  return {
    emAndamento: true,
    carregado: true,
    descarregado: false,
    destino,
    posicao: posicaoLonge,
    agora,
    ...over,
  };
}

describe("previsaoChegada", () => {
  it("prevê a partir da hora da posição, com folga de caminhão, arredondado a 5 min", () => {
    // 1h30 de rota de carro → 1h52m30 de caminhão, a partir de 12h55 → 14h47:30 → 14h50.
    const p = previsaoChegada(entrada(), 90 * 60);
    expect(p).toEqual({
      tipo: "PREVISTA",
      destinoNome: "Obra Ponta Grossa",
      chegaEm: "2026-10-01T17:50:00.000Z",
      atualizadoEm: "2026-10-01T15:55:00.000Z",
    });
  });

  it("perto do destino é 'chegando', sem rota", () => {
    const e = entrada({ posicao: { lat: -25.091, lng: -50.161, capturadoEm: agora } });
    expect(precisaCalcularRota(e)).toBe(false);
    expect(previsaoChegada(e, null)).toMatchObject({ tipo: "CHEGANDO", destinoNome: "Obra Ponta Grossa" });
  });

  it("previsão nunca cai no passado", () => {
    const e = entrada({ posicao: { ...posicaoLonge, capturadoEm: new Date("2026-10-01T15:45:00Z") } });
    const p = previsaoChegada(e, 60);
    expect(p?.tipo).toBe("PREVISTA");
    expect(new Date((p as { chegaEm: string }).chegaEm).getTime()).toBeGreaterThanOrEqual(agora.getTime() + 5 * 60_000);
  });

  it.each([
    ["antes de carregar (depende da fila na pedreira)", { carregado: false }],
    ["já descarregou", { descarregado: true }],
    ["viagem que não está em andamento", { emAndamento: false }],
    ["sem destino conhecido", { destino: null }],
    ["sem posição", { posicao: null }],
    ["posição velha (sem sinal há 30 min)", { posicao: { ...posicaoLonge, capturadoEm: new Date("2026-10-01T15:30:00Z") } }],
  ])("sem previsão: %s", (_nome, over) => {
    const e = entrada(over as Partial<EntradaPrevisao>);
    expect(precisaCalcularRota(e)).toBe(false);
    expect(previsaoChegada(e, 3600)).toBeNull();
  });

  it("roteador fora do ar: sem previsão, sem chute", () => {
    expect(precisaCalcularRota(entrada())).toBe(true);
    expect(previsaoChegada(entrada(), null)).toBeNull();
  });
});
