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
export async function pegarCoords(timeoutMs = 15_000): Promise<Coords | null> {
  // Lazy import pra evitar ciclo (event-reporter → api → ...)
  const { reportarEvento } = await import("./event-reporter");
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    void reportarEvento("gps_falhou", { motivo: "hardware" });
    return null;
  }
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      void reportarEvento("gps_falhou", { motivo: "timeout" });
      resolve(null);
    }, timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          precisao: pos.coords.accuracy,
        };
        void reportarEvento("gps_capturado", {
          lat: coords.lat,
          lng: coords.lng,
          precisao: coords.precisao ?? null,
          fonte: "current",
        });
        resolve(coords);
      },
      (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        const motivo =
          err.code === 1 ? "permissao" : err.code === 3 ? "timeout" : "hardware";
        void reportarEvento("gps_falhou", { motivo, msg: err.message });
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
