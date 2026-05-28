/**
 * Helpers de geolocalização pontual no browser. Diferente do nativo, o PWA
 * não faz tracking contínuo — só pega coords pontuais (clique em "Estou no
 * local de descarga") via Geolocation API.
 */

export const RAIO_ALERTA_CARGA_M = 300;

export type Coords = { lat: number; lng: number; precisao?: number };

/**
 * Pede permissão e captura a posição atual via Geolocation API.
 * Timeout 15s. enableHighAccuracy=true pra ter precisão de GPS em vez
 * de só wifi/IP.
 */
export function pegarCoords(timeoutMs = 15_000): Promise<Coords | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve(null);
    }, timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precisao: pos.coords.accuracy,
        });
      },
      () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/** Distância em metros entre dois pontos lat/lng (Haversine). */
export function haversineMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
