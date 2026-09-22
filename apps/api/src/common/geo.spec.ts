import { describe, expect, it } from "vitest";
import { distanciaKm, distanciaMetros } from "./geo";

/**
 * A distância entre dois pontos do globo, que era cinco funções.
 *
 * Os números de referência vêm de coordenadas reais das cidades; a tolerância
 * é de 1 km porque haversine assume esfera e a Terra não é uma.
 */

const CURITIBA = [-25.4284, -49.2733] as const;
const SAO_PAULO = [-23.5505, -46.6333] as const;

describe("distância em metros", () => {
  it("Curitiba → São Paulo dá ~338 km", () => {
    const m = distanciaMetros(...CURITIBA, ...SAO_PAULO);
    expect(m / 1000).toBeGreaterThan(337);
    expect(m / 1000).toBeLessThan(340);
  });

  it("é simétrica — a ordem dos pontos não muda a distância", () => {
    expect(distanciaMetros(...CURITIBA, ...SAO_PAULO)).toBeCloseTo(
      distanciaMetros(...SAO_PAULO, ...CURITIBA),
      6,
    );
  });

  it("o mesmo ponto dá zero, não um resto de arredondamento", () => {
    expect(distanciaMetros(...CURITIBA, ...CURITIBA)).toBe(0);
  });

  it("um metro de diferença mede cerca de um metro", () => {
    // ~0,000009° de latitude ≈ 1 m. É a escala em que o raio de um local vive.
    const m = distanciaMetros(-25.4284, -49.2733, -25.428409, -49.2733);
    expect(m).toBeGreaterThan(0.9);
    expect(m).toBeLessThan(1.1);
  });
});

describe("a trava do asin", () => {
  /**
   * ⚠️ O caso que separava as cinco cópias: sem `Math.min(1, …)`, ponto quase
   * antípoda devolve NaN — e NaN compara falso com tudo, então o candidato
   * some do pré-filtro de raio sem erro nenhum aparecer.
   */
  it("pontos antípodas devolvem meia volta ao mundo, nunca NaN", () => {
    const m = distanciaMetros(19.9492077, -12.4639344, -19.9492077, 167.5360656);
    expect(Number.isNaN(m)).toBe(false);
    expect(m / 1000).toBeGreaterThan(19_000);
    expect(m / 1000).toBeLessThan(20_100);
  });

  it("e nenhum par antípoda produz NaN", () => {
    for (let lat = -89; lat <= 89; lat += 7) {
      for (let lng = -179; lng <= 179; lng += 11) {
        const oposto = lng > 0 ? lng - 180 : lng + 180;
        expect(Number.isNaN(distanciaMetros(lat, lng, -lat, oposto))).toBe(false);
      }
    }
  });
});

describe("quilômetros", () => {
  it("é a mesma conta dividida por mil — a unidade não se digita à mão", () => {
    expect(distanciaKm(...CURITIBA, ...SAO_PAULO)).toBeCloseTo(
      distanciaMetros(...CURITIBA, ...SAO_PAULO) / 1000,
      9,
    );
  });
});
