/**
 * Cálculo de "pedágios na rota" 100% offline. Mesma lógica do app nativo
 * (apps/motorista-app/lib/pedagios-offline.ts) e do backend.
 *
 * Permite alertar motorista sem internet, desde que a lista de pedágios
 * e a geometria tenham sido cacheadas antes (em geral, na 1ª abertura
 * com sinal nos últimos 24h).
 */

import polylineLib from "@mapbox/polyline";

export type PedagioCadastrado = {
  id: string;
  nome: string;
  rodovia: string | null;
  concessionaria: string | null;
  lat: number;
  lng: number;
};

export type PedagioNaRotaOffline = PedagioCadastrado & {
  distanciaMetros: number;
};

const DISTANCIA_MAX_METROS = 150;
const ENVELOPE_PADDING_GRAUS = 0.05;
const DISTANCIA_MAX_LINHA_RETA_M = 1000;

export function pedagiosNaRotaOffline(
  geometria: string | null | undefined,
  pedagios: PedagioCadastrado[],
): PedagioNaRotaOffline[] {
  if (!geometria || pedagios.length === 0) return [];

  let pontos: Array<[number, number]>;
  try {
    pontos = polylineLib.decode(geometria) as Array<[number, number]>;
  } catch {
    return [];
  }
  if (pontos.length < 2) return [];

  const bbox = bboxComFolga(pontos);
  const candidatos = pedagios.filter(
    (p) =>
      p.lat >= bbox.minLat &&
      p.lat <= bbox.maxLat &&
      p.lng >= bbox.minLng &&
      p.lng <= bbox.maxLng,
  );
  if (candidatos.length === 0) return [];

  const proximos: PedagioNaRotaOffline[] = [];
  for (const p of candidatos) {
    const d = menorDistanciaAteRota(p.lat, p.lng, pontos);
    if (d <= DISTANCIA_MAX_METROS) {
      proximos.push({ ...p, distanciaMetros: Math.round(d) });
    }
  }
  proximos.sort((a, b) => a.distanciaMetros - b.distanciaMetros);
  return proximos;
}

/**
 * Fallback grosseiro: sem polyline (rota nova offline), considera a
 * linha reta entre origem e destino + buffer largo (1km). Aceita falsos
 * positivos pra nao deixar passar rotas com pedagio sem aviso.
 */
export function pedagiosNaLinhaReta(
  origemLat: number,
  origemLng: number,
  destinoLat: number,
  destinoLng: number,
  pedagios: PedagioCadastrado[],
): PedagioNaRotaOffline[] {
  if (pedagios.length === 0) return [];
  const pontos: Array<[number, number]> = [
    [origemLat, origemLng],
    [destinoLat, destinoLng],
  ];
  const bbox = bboxComFolga(pontos);
  const candidatos = pedagios.filter(
    (p) =>
      p.lat >= bbox.minLat &&
      p.lat <= bbox.maxLat &&
      p.lng >= bbox.minLng &&
      p.lng <= bbox.maxLng,
  );
  if (candidatos.length === 0) return [];

  const proximos: PedagioNaRotaOffline[] = [];
  for (const p of candidatos) {
    const d = menorDistanciaAteRota(p.lat, p.lng, pontos);
    if (d <= DISTANCIA_MAX_LINHA_RETA_M) {
      proximos.push({ ...p, distanciaMetros: Math.round(d) });
    }
  }
  proximos.sort((a, b) => a.distanciaMetros - b.distanciaMetros);
  return proximos;
}

function bboxComFolga(pontos: Array<[number, number]>): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  let minLat = pontos[0]![0];
  let maxLat = pontos[0]![0];
  let minLng = pontos[0]![1];
  let maxLng = pontos[0]![1];
  for (const [lat, lng] of pontos) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return {
    minLat: minLat - ENVELOPE_PADDING_GRAUS,
    maxLat: maxLat + ENVELOPE_PADDING_GRAUS,
    minLng: minLng - ENVELOPE_PADDING_GRAUS,
    maxLng: maxLng + ENVELOPE_PADDING_GRAUS,
  };
}

const R_TERRA_M = 6_371_000;
const toRad = (g: number): number => (g * Math.PI) / 180;

function haversineMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRA_M * Math.asin(Math.sqrt(a));
}

function menorDistanciaAteRota(
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

function distanciaPontoSegmento(
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
    return haversineMetros(lat, lng, a[0], a[1]);
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  const projX = ax + tc * dx;
  const projY = ay + tc * dy;
  return haversineMetros(lat, lng, projY, projX);
}
