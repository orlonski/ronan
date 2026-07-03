/**
 * Helpers geográficos client-side. Usados pra detectar o local de
 * carga/descarga automaticamente a partir de pontos GPS capturados
 * durante o tracking, comparando com a lista de Locais cadastrados.
 */

import type { FonteGps } from "@ronan/shared-types";

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

export type CoordsPrecisas = {
  lat: number;
  lng: number;
  precisao: number | null;
  // Fonte do sinal nesta leitura (pra gravar/auditar). PRECISA = fix Highest,
  // BALANCED = fallback, CACHE = last-known do sistema (posição pode estar velha).
  fonte: FonteGps;
};

/** Por que a captura falhou — pra UI mostrar a mensagem certa (não só "permissão"). */
export type GpsFalha = "permissao" | "timeout" | "hardware";
export type GpsResultado =
  | { ok: true; coords: CoordsPrecisas }
  | { ok: false; motivo: GpsFalha };

/**
 * Mensagem pro motorista por motivo de falha do GPS. `ajustes: true` quando faz
 * sentido mostrar o botão "Abrir ajustes" (Linking.openSettings) — só no caso de
 * permissão, onde 1 toque resolve. Texto curto e direto (motorista leigo).
 */
export function mensagemGpsFalha(motivo: GpsFalha): { msg: string; ajustes: boolean } {
  switch (motivo) {
    case "permissao":
      return {
        msg: "A localização do app está desligada. Toque em Abrir ajustes e ligue a localização.",
        ajustes: true,
      };
    case "hardware":
      return {
        msg: "Não consegui ligar o GPS. Confira se o GPS do celular está ligado e tente de novo.",
        ajustes: false,
      };
    case "timeout":
    default:
      return {
        msg: "Sinal de GPS fraco aqui. Vá para um lugar mais aberto (fora do galpão) e toque de novo.",
        ajustes: false,
      };
  }
}

/**
 * Captura GPS fiel: amostra o GPS em alta precisão por até `maxMs`, ficando com
 * a leitura de melhor precisão. O 1º fix costuma ser grosseiro e converge em
 * segundos — por isso a amostragem. Para cedo ao atingir `alvoMetros`.
 * `onAmostra` recebe a precisão corrente (m) a cada leitura, pra UI mostrar
 * "±X m" ao vivo.
 *
 * Se o watch de alta precisão não pegar NENHUMA amostra a tempo (sinal fraco /
 * dentro de galpão), cai numa cadeia de fallback do mais preciso ao mais
 * garantido: fix `Balanced` (engancha mais rápido que Highest) e, por último,
 * `getLastKnownPositionAsync` (posição em cache do sistema — retorna na hora
 * mesmo sem sinal, o motorista estava ao ar livre segundos atrás). O aviso
 * "Sinal fraco" da UI cobre o caso de a leitura sair grosseira.
 *
 * Retorna `{ ok: false, motivo }` distinguindo permissão negada, timeout de
 * sinal e erro de hardware — pra tela não culpar a permissão indevidamente.
 */
export async function pegarCoordsPrecisa(opts?: {
  alvoMetros?: number;
  maxMs?: number;
  onAmostra?: (precisaoAtual: number | null) => void;
}): Promise<GpsResultado> {
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
        return { ok: false, motivo: "permissao" };
      }
    }

    // Ref-object em vez de `let` solto: a mutação acontece dentro de closures
    // (watch callback), e o control-flow do TS estreitaria um `let` pra null.
    const ref: { melhor: CoordsPrecisas | null } = { melhor: null };
    const melhorAccuracy = () => ref.melhor?.precisao ?? Infinity;

    const amostrar = (lat: number, lng: number, accuracy: number | null) => {
      const acc = accuracy ?? Infinity;
      if (!ref.melhor || acc < melhorAccuracy()) {
        ref.melhor = { lat, lng, precisao: accuracy ?? null, fonte: "PRECISA" };
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
      return { ok: true, coords: ref.melhor };
    }

    // Nenhuma amostra do watch (sinal ruim / indoor). Fallback 1: fix Balanced,
    // que engancha bem mais rápido que Highest/High em sinal fraco.
    const balanced = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    if (balanced && "coords" in balanced) {
      void reportarEvento("gps_capturado", {
        lat: balanced.coords.latitude,
        lng: balanced.coords.longitude,
        precisao: balanced.coords.accuracy ?? null,
        fonte: "balanced",
      });
      return {
        ok: true,
        coords: {
          lat: balanced.coords.latitude,
          lng: balanced.coords.longitude,
          precisao: balanced.coords.accuracy ?? null,
          fonte: "BALANCED",
        },
      };
    }

    // Fallback 2: posição em cache do SO. Retorna na hora mesmo sem sinal —
    // melhor uma posição de ~2min atrás (aqui-ish) do que travar o motorista.
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 120_000,
      requiredAccuracy: 150,
    });
    if (last) {
      void reportarEvento("gps_capturado", {
        lat: last.coords.latitude,
        lng: last.coords.longitude,
        precisao: last.coords.accuracy ?? null,
        fonte: "last_known",
      });
      return {
        ok: true,
        coords: {
          lat: last.coords.latitude,
          lng: last.coords.longitude,
          precisao: last.coords.accuracy ?? null,
          fonte: "CACHE",
        },
      };
    }

    void reportarEvento("gps_falhou", { motivo: "timeout" });
    return { ok: false, motivo: "timeout" };
  } catch (err) {
    void reportarEvento("gps_falhou", {
      motivo: "hardware",
      msg: (err as Error)?.message,
    });
    return { ok: false, motivo: "hardware" };
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
