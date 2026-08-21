import { describe, expect, it } from "vitest";
import {
  codificarPolyline,
  decodificarPolyline,
  valhallaShapeParaPolyline5,
} from "./polyline";

describe("polyline", () => {
  it("decodifica o exemplo canônico do Google (precisão 5)", () => {
    // Exemplo da documentação oficial do Encoded Polyline Algorithm.
    const pontos = decodificarPolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pontos).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("codifica de volta o exemplo canônico", () => {
    const texto = codificarPolyline([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
    expect(texto).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });

  it("faz ida e volta sem perder precisão em coordenadas do Paraná", () => {
    const original: [number, number][] = [
      [-25.3422263, -49.5360858],
      [-25.4589, -49.528],
      [-25.5549487, -49.4544857],
    ];
    const voltou = decodificarPolyline(codificarPolyline(original, 6), 6);
    voltou.forEach(([lat, lng], i) => {
      expect(lat).toBeCloseTo(original[i]![0], 6);
      expect(lng).toBeCloseTo(original[i]![1], 6);
    });
  });

  it("converte shape do Valhalla (6) pra polyline 5 mantendo a geografia", () => {
    const original: [number, number][] = [
      [-25.3422263, -49.5360858],
      [-25.4589, -49.528],
      [-25.5549487, -49.4544857],
    ];
    const shapeValhalla = codificarPolyline(original, 6);
    const convertido = valhallaShapeParaPolyline5(shapeValhalla);

    const lido = decodificarPolyline(convertido); // precisão 5, o default do sistema
    expect(lido).toHaveLength(3);
    lido.forEach(([lat, lng], i) => {
      // Precisão 5 = ~1 m. O que não pode é a linha mudar de ESCALA.
      expect(lat).toBeCloseTo(original[i]![0], 4);
      expect(lng).toBeCloseTo(original[i]![1], 4);
    });
  });

  it("ler shape de precisão 6 como 5 estoura a linha pra fora do globo — o bug que a conversão evita", () => {
    const shape6 = codificarPolyline([[-25.3422263, -49.5360858]], 6);
    const errado = decodificarPolyline(shape6); // sem passar precisão
    // Dez vezes a escala: latitude -253°, coordenada que nem existe. O mapa não
    // desenha nada e nada no log diz por quê.
    expect(errado[0]![0]).toBeCloseTo(-253.42226, 3);
    expect(errado[0]![1]).toBeCloseTo(-495.360858, 3);
    expect(Math.abs(errado[0]![0])).toBeGreaterThan(90);
  });

  it("aguenta polyline vazia", () => {
    expect(decodificarPolyline("")).toEqual([]);
    expect(codificarPolyline([])).toBe("");
  });
});
