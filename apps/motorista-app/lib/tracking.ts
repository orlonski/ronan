import { useEffect, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  clearViagemAndamento,
  getViagemAndamento,
  setViagemAndamento,
  type Ponto,
  type ViagemEmAndamento,
} from "./tracking-storage";
import { TRACKING_TASK } from "./tracking-task";

const REFRESH_MS = 5_000;
const NOTIFICATION_BODY_INICIAL =
  "Tocando KM real percorrido. Toque pra finalizar.";

/** True se o foreground service de tracking está ativo. */
export async function isTrackingAtivo(): Promise<boolean> {
  const Location = await import("expo-location");
  return Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
}

export type TrackingResumo = {
  kmReal: number;
  duracaoMin: number;
  velocidadeMediaKmh: number;
  pontos: Ponto[];
  iniciadoEm: string;
  id: string;
};

/**
 * Inicia tracking GPS em background (foreground service no Android).
 * Pede permissão de background location se necessário. Retorna false
 * se motorista negou permissão.
 */
export async function iniciarTracking(): Promise<boolean> {
  const Location = await import("expo-location");

  // 1) foreground primeiro (precondição pra background)
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    const r = await Location.requestForegroundPermissionsAsync();
    if (r.status !== "granted") return false;
  }

  // 2) background — Android pede tela "Permitir o tempo todo"
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== "granted") {
    const r = await Location.requestBackgroundPermissionsAsync();
    if (r.status !== "granted") return false;
  }

  // 3) cria registro local da viagem em andamento
  const novo: ViagemEmAndamento = {
    id: makeUuid(),
    iniciadoEm: new Date().toISOString(),
    pontos: [],
  };
  await setViagemAndamento(novo);

  // 4) inicia a task em background com foreground service (Android)
  const isRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  }

  await Location.startLocationUpdatesAsync(TRACKING_TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 50, // captura a cada 50m
    timeInterval: 30_000, // ou 30s, o que ocorrer antes
    deferredUpdatesInterval: 30_000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Viagem em andamento",
      notificationBody: NOTIFICATION_BODY_INICIAL,
      notificationColor: "#ea580c",
    },
  });

  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  return true;
}

/**
 * Para o tracking e devolve resumo (KM, duração, etc). NÃO limpa o
 * AsyncStorage — caller decide (Finalizar limpa, Cancelar limpa, mas
 * a navegação pra nova-viagem precisa dos pontos antes de limpar).
 */
export async function pararTracking(): Promise<TrackingResumo | null> {
  const Location = await import("expo-location");

  const isRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  }

  const v = await getViagemAndamento();
  if (!v) return null;

  return calcularResumo(v);
}

/** Cancela e descarta a viagem em andamento (sem salvar nada). */
export async function cancelarTracking(): Promise<void> {
  const Location = await import("expo-location");
  const isRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  }
  await clearViagemAndamento();
}

export function calcularResumo(v: ViagemEmAndamento): TrackingResumo {
  const kmReal = somarKm(v.pontos);
  const duracaoMs = Date.now() - new Date(v.iniciadoEm).getTime();
  const duracaoMin = Math.max(0, duracaoMs / 60_000);
  const velocidadeMediaKmh = duracaoMin > 0 ? (kmReal / duracaoMin) * 60 : 0;
  return {
    id: v.id,
    iniciadoEm: v.iniciadoEm,
    pontos: v.pontos,
    kmReal,
    duracaoMin,
    velocidadeMediaKmh,
  };
}

/** Soma das distâncias Haversine entre pontos consecutivos (em km). */
export function somarKm(pontos: Ponto[]): number {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    total += haversineKm(pontos[i - 1], pontos[i]);
  }
  return total;
}

function haversineKm(a: Ponto, b: Ponto): number {
  const R = 6371; // raio da Terra em km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Hook reativo que lê AsyncStorage a cada 5s pra atualizar a UI da
 * tela "viagem em andamento". Não é mais sofisticado que isso — a
 * tela só precisa refletir os pontos que o task em background salva.
 */
export function useViagemAndamento(active = true): {
  data: ViagemEmAndamento | null;
  resumo: TrackingResumo | null;
} {
  const [data, setData] = useState<ViagemEmAndamento | null>(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;

    const tick = async () => {
      const v = await getViagemAndamento();
      if (alive) setData(v);
    };

    void tick();
    const id = setInterval(() => void tick(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);

  return { data, resumo: data ? calcularResumo(data) : null };
}
