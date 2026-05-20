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

/** "120 m" / "1,2 km" / "23 km" pra exibir distância amigável. */
export function formatarDistancia(metros: number): string {
  if (metros < 1000) return `${Math.round(metros)} m`;
  const km = metros / 1000;
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km)} km`;
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

/**
 * GPS pre-aquecido: tenta last-known (instantâneo, <=1min idade), depois
 * fix novo com cap de 15s. Permissão negada / GPS off => null. Lazy import
 * evita crash no boot do expo-router.
 */
export async function pegarCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const Location = await import("expo-location");
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== "granted") {
      const r = await Location.requestForegroundPermissionsAsync();
      if (r.status !== "granted") return null;
    }
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 60_000,
      requiredAccuracy: 200,
    });
    if (last) {
      return { lat: last.coords.latitude, lng: last.coords.longitude };
    }
    const result = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    if (!result || !("coords" in result)) return null;
    return { lat: result.coords.latitude, lng: result.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Cap rápido (2s, só last-known) — usado quando precisa de coords mas
 * não pode travar o motorista.
 */
export async function pegarCoordsRapido(): Promise<{ lat: number; lng: number } | null> {
  try {
    const Location = await import("expo-location");
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== "granted") return null;
    const last = await Promise.race([
      Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 500 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (!last || !("coords" in last)) return null;
    return { lat: last.coords.latitude, lng: last.coords.longitude };
  } catch {
    return null;
  }
}
