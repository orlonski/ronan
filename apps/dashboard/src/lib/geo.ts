/**
 * Helpers geográficos client-side. Usados pra sugerir locais próximos a
 * partir de coordenadas — ex.: sugerir local de descarga baseado no lat/lng
 * que o motorista capturou no momento do lançamento da viagem.
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
