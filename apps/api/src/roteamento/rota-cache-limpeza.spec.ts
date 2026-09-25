import { describe, expect, it } from "vitest";
import { codificarPolyline } from "./polyline";
import { rotaCacheadaEncaixa } from "./rota-cache-limpeza.service";

const curitiba = { lat: -25.43, lng: -49.27 };
const joinville = { lat: -26.3, lng: -48.85 };
const campinas = { lat: -22.9, lng: -47.06 };

describe("rotaCacheadaEncaixa", () => {
  it("rota que começa e termina nos locais: fica", () => {
    const g = codificarPolyline([
      [-25.431, -49.271],
      [-25.9, -49.0],
      [-26.299, -48.851],
    ]);
    expect(rotaCacheadaEncaixa(g, curitiba, joinville)).toBe(true);
  });

  it("destino fora do mapa encaixado no Paraná: sai", () => {
    // O que o OSRM do Sul devolvia pra Curitiba→Campinas: a rota termina na
    // divisa PR/SP, a centenas de km do Local.
    const g = codificarPolyline([
      [-25.431, -49.271],
      [-24.2, -49.6],
      [-23.95, -49.55],
    ]);
    expect(rotaCacheadaEncaixa(g, curitiba, campinas)).toBe(false);
  });

  it("origem fora do mapa: sai", () => {
    const g = codificarPolyline([
      [-23.95, -49.55],
      [-26.299, -48.851],
    ]);
    expect(rotaCacheadaEncaixa(g, campinas, joinville)).toBe(false);
  });

  it("sem geometria ou sem coordenada: não sei, fica", () => {
    expect(rotaCacheadaEncaixa(null, curitiba, joinville)).toBe(true);
    const g = codificarPolyline([
      [-25.431, -49.271],
      [-26.299, -48.851],
    ]);
    expect(rotaCacheadaEncaixa(g, { lat: null, lng: null }, joinville)).toBe(true);
    expect(rotaCacheadaEncaixa(g, null, joinville)).toBe(true);
  });
});
