/**
 * Helpers geográficos client-side. Usados pra detectar o local de
 * carga/descarga automaticamente a partir de pontos GPS capturados
 * durante o tracking, comparando com a lista de Locais cadastrados.
 */

const RAIO_TERRA_M = 6_371_000;

export function haversineMetros(
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
  return 2 * RAIO_TERRA_M * Math.asin(Math.sqrt(a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export type LocalComCoords = {
  id: string;
  nome: string;
  lat: number | null;
  lng: number | null;
};

export type Match<L extends LocalComCoords> = {
  local: L;
  distanciaMetros: number;
};

/**
 * Acha o local cadastrado mais próximo de uma posição GPS, dentro
 * do raio em metros. Ignora locais sem lat/lng. Retorna null se
 * nada estiver no raio.
 */
export function localMaisProximo<L extends LocalComCoords>(
  lat: number,
  lng: number,
  locais: L[],
  raioMetros = 200,
): Match<L> | null {
  let melhor: L | null = null;
  let menorDist = raioMetros;
  for (const l of locais) {
    if (l.lat == null || l.lng == null) continue;
    const d = haversineMetros(lat, lng, l.lat, l.lng);
    if (d < menorDist) {
      melhor = l;
      menorDist = d;
    }
  }
  if (!melhor) return null;
  return { local: melhor, distanciaMetros: Math.round(menorDist) };
}
