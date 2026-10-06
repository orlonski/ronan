import { distanciaMetros } from "./geo";

/**
 * Distância de um ponto até uma rota (polyline JÁ decodificada — o decoder
 * mora em `roteamento/polyline.ts`). Saiu do `pedagios-rodovia-consulta`
 * quando a conferência da tag passou a precisar da MESMA regra de "praça na
 * rota" — e também da posição dela ao longo do traçado, que dá a ordem.
 */

/** Menor distância (m) do ponto até a polyline decodificada. */
export function menorDistanciaAteRota(
  lat: number,
  lng: number,
  pontos: Array<[number, number]>,
): number {
  let min = Infinity;
  for (let i = 0; i < pontos.length - 1; i++) {
    const d = distanciaPontoSegmento(lat, lng, pontos[i]!, pontos[i + 1]!);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Distância mínima do ponto até o segmento. Projeção planar local (cartesiana
 * em lat/lng) pra achar o ponto mais próximo no segmento; depois haversine
 * pra distância real. Suficiente pra distâncias curtas (segmentos OSRM têm
 * ~poucas centenas de metros).
 */
export function distanciaPontoSegmento(
  lat: number,
  lng: number,
  a: [number, number],
  b: [number, number],
): number {
  const ax = a[1];
  const ay = a[0];
  const bx = b[1];
  const by = b[0];
  const px = lng;
  const py = lat;

  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return distanciaMetros(lat, lng, a[0], a[1]);
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  const projX = ax + tc * dx;
  const projY = ay + tc * dy;
  return distanciaMetros(lat, lng, projY, projX);
}
