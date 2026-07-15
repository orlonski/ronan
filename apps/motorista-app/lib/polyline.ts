/**
 * Polyline simplification via Douglas-Peucker.
 *
 * Reduz pontos GPS mantendo a forma da rota. A tolerância padrão (3m)
 * está abaixo da precisão típica do GPS (5-10m) — então remove apenas
 * "ruído" e duplicatas (motorista parado em semáforo gerando 30 pontos
 * no mesmo lugar) sem afetar a rota visualmente.
 *
 * Resultado típico: 480 pontos → ~80-120 pontos sem perda perceptível.
 */
import { haversineMetros } from "./geo";

export type PontoComMeta = {
  lat: number;
  lng: number;
  capturadoEm: string;
  velocidade?: number;
  precisao?: number;
};

const TOLERANCIA_METROS_DEFAULT = 3;

/**
 * Distância perpendicular do ponto P à linha A-B em metros (aproximação plana).
 * Pra distâncias pequenas (< 1km), a aproximação cartesiana funciona bem.
 */
function distanciaPerpendicular(
  p: PontoComMeta,
  a: PontoComMeta,
  b: PontoComMeta,
): number {
  // Aproximação local: 1 grau de lat ≈ 111km, 1 grau de lng varia com lat
  const latRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const mPerLat = 111_000;
  const mPerLng = 111_000 * Math.cos(latRad);

  const ax = a.lng * mPerLng;
  const ay = a.lat * mPerLat;
  const bx = b.lng * mPerLng;
  const by = b.lat * mPerLat;
  const px = p.lng * mPerLng;
  const py = p.lat * mPerLat;

  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) {
    // A e B no mesmo ponto — distância de P até A
    return haversineMetros(p.lat, p.lng, a.lat, a.lng);
  }

  // Projeta P no segmento A-B
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tClamped = Math.max(0, Math.min(1, t));
  const projX = ax + tClamped * dx;
  const projY = ay + tClamped * dy;

  return Math.hypot(px - projX, py - projY);
}

/**
 * Douglas-Peucker recursivo. Mantém pontos cuja distância
 * perpendicular ao segmento "atalho" excede a tolerância.
 */
function dpRecursivo(
  pontos: PontoComMeta[],
  inicio: number,
  fim: number,
  toleranciaM: number,
  manter: boolean[],
): void {
  if (fim - inicio < 2) return;

  let maxDist = 0;
  let indiceMax = -1;

  for (let i = inicio + 1; i < fim; i++) {
    const d = distanciaPerpendicular(pontos[i]!, pontos[inicio]!, pontos[fim]!);
    if (d > maxDist) {
      maxDist = d;
      indiceMax = i;
    }
  }

  if (maxDist > toleranciaM && indiceMax !== -1) {
    manter[indiceMax] = true;
    dpRecursivo(pontos, inicio, indiceMax, toleranciaM, manter);
    dpRecursivo(pontos, indiceMax, fim, toleranciaM, manter);
  }
}

/**
 * GPS reporta velocidade/precisão -1 quando desconhecidas (parado, 1º fix). O
 * schema exige nonnegative — um único ponto com -1 trava o salvar. Zera os
 * negativos aqui (chokepoint antes do payload) pra cobrir pontos JÁ capturados.
 */
function normalizarMeta(p: PontoComMeta): PontoComMeta {
  const velocidade = p.velocidade != null && p.velocidade >= 0 ? p.velocidade : undefined;
  const precisao = p.precisao != null && p.precisao >= 0 ? p.precisao : undefined;
  if (velocidade === p.velocidade && precisao === p.precisao) return p;
  return { ...p, velocidade, precisao };
}

/**
 * Simplifica array de pontos. Sempre mantém o primeiro e o último.
 * Pontos com timestamp/velocidade/accuracy preservados nos pontos
 * que sobrevivem (velocidade/precisão negativas do GPS são normalizadas).
 */
export function simplificarPontos(
  pontos: PontoComMeta[],
  toleranciaM: number = TOLERANCIA_METROS_DEFAULT,
): PontoComMeta[] {
  if (pontos.length <= 2) return pontos.map(normalizarMeta);

  const manter = new Array<boolean>(pontos.length).fill(false);
  manter[0] = true;
  manter[pontos.length - 1] = true;

  dpRecursivo(pontos, 0, pontos.length - 1, toleranciaM, manter);

  return pontos.filter((_, i) => manter[i]).map(normalizarMeta);
}
