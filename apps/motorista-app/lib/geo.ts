/**
 * Helpers geográficos client-side. Usados pra detectar o local de
 * carga/descarga automaticamente a partir de pontos GPS capturados
 * durante o tracking, comparando com a lista de Locais cadastrados.
 */

const RAIO_TERRA_M = 6_371_000;

/**
 * Raio (em metros) usado no alerta "você está perto do local de carga" no
 * lançamento de viagem. Conservador o suficiente pra reduzir falso-positivo
 * (motorista entrou na rua mas está no cliente ali do lado).
 */
export const RAIO_ALERTA_CARGA_M = 150;

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
  // Lazy import pra não criar ciclo (event-reporter usa api → queries → geo).
  const { reportarEvento } = await import("./event-reporter");
  try {
    const Location = await import("expo-location");
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== "granted") {
      const r = await Location.requestForegroundPermissionsAsync();
      if (r.status !== "granted") {
        void reportarEvento("gps_falhou", { motivo: "permissao" });
        return null;
      }
    }
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 60_000,
      requiredAccuracy: 200,
    });
    if (last) {
      void reportarEvento("gps_capturado", {
        lat: last.coords.latitude,
        lng: last.coords.longitude,
        precisao: last.coords.accuracy ?? null,
        fonte: "last_known",
      });
      return { lat: last.coords.latitude, lng: last.coords.longitude };
    }
    const result = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    if (!result || !("coords" in result)) {
      void reportarEvento("gps_falhou", { motivo: "timeout" });
      return null;
    }
    void reportarEvento("gps_capturado", {
      lat: result.coords.latitude,
      lng: result.coords.longitude,
      precisao: result.coords.accuracy ?? null,
      fonte: "current",
    });
    return { lat: result.coords.latitude, lng: result.coords.longitude };
  } catch (err) {
    void reportarEvento("gps_falhou", {
      motivo: "hardware",
      msg: (err as Error)?.message,
    });
    return null;
  }
}

export type CoordsPrecisas = { lat: number; lng: number; precisao: number | null };

/**
 * Captura GPS fiel: ignora o cache (last-known) e amostra o GPS em alta
 * precisão por até `maxMs`, ficando com a leitura de melhor precisão. O 1º
 * fix de GPS costuma ser grosseiro e converge em segundos — por isso a
 * amostragem. Para cedo ao atingir `alvoMetros`. `onAmostra` recebe a
 * precisão corrente (em metros) a cada leitura, pra UI mostrar "±X m" ao vivo.
 * Permissão negada / GPS off => null.
 */
export async function pegarCoordsPrecisa(opts?: {
  alvoMetros?: number;
  maxMs?: number;
  onAmostra?: (precisaoAtual: number | null) => void;
}): Promise<CoordsPrecisas | null> {
  const alvoMetros = opts?.alvoMetros ?? 10;
  const maxMs = opts?.maxMs ?? 20_000;
  const onAmostra = opts?.onAmostra;
  // Lazy import pra não criar ciclo (event-reporter usa api → queries → geo).
  const { reportarEvento } = await import("./event-reporter");
  try {
    const Location = await import("expo-location");
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== "granted") {
      const r = await Location.requestForegroundPermissionsAsync();
      if (r.status !== "granted") {
        void reportarEvento("gps_falhou", { motivo: "permissao" });
        return null;
      }
    }

    // Ref-object em vez de `let` solto: a mutação acontece dentro de closures
    // (watch callback), e o control-flow do TS estreitaria um `let` pra null.
    const ref: { melhor: CoordsPrecisas | null } = { melhor: null };
    const melhorAccuracy = () => ref.melhor?.precisao ?? Infinity;

    const amostrar = (lat: number, lng: number, accuracy: number | null) => {
      const acc = accuracy ?? Infinity;
      if (!ref.melhor || acc < melhorAccuracy()) {
        ref.melhor = { lat, lng, precisao: accuracy ?? null };
      }
      onAmostra?.(ref.melhor.precisao);
    };

    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let sub: { remove: () => void } | null = null;
      let finalizado = false;
      const finalizar = () => {
        if (finalizado) return;
        finalizado = true;
        if (timer) clearTimeout(timer);
        sub?.remove();
        resolve();
      };
      timer = setTimeout(finalizar, maxMs);
      void Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (pos) => {
          amostrar(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
          if (melhorAccuracy() <= alvoMetros) finalizar();
        },
      ).then((s) => {
        if (finalizado) {
          s.remove();
        } else {
          sub = s;
        }
      });
    });

    if (ref.melhor) {
      void reportarEvento("gps_capturado", {
        lat: ref.melhor.lat,
        lng: ref.melhor.lng,
        precisao: ref.melhor.precisao,
        fonte: "precisa",
      });
      return ref.melhor;
    }

    // Nenhuma amostra do watch (sinal ruim / timeout) — última tentativa.
    const result = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
    if (!result || !("coords" in result)) {
      void reportarEvento("gps_falhou", { motivo: "timeout" });
      return null;
    }
    void reportarEvento("gps_capturado", {
      lat: result.coords.latitude,
      lng: result.coords.longitude,
      precisao: result.coords.accuracy ?? null,
      fonte: "precisa",
    });
    return {
      lat: result.coords.latitude,
      lng: result.coords.longitude,
      precisao: result.coords.accuracy ?? null,
    };
  } catch (err) {
    void reportarEvento("gps_falhou", {
      motivo: "hardware",
      msg: (err as Error)?.message,
    });
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
