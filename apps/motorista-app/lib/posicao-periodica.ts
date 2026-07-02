/**
 * Captura periódica de posição (controle de frota). Diferente do tracking
 * de viagem (alta frequência, durante viagem ativa), aqui:
 * - Roda a cada ~15min com foreground service Android
 * - Opt-in pelo motorista (config persistida no backend e cache local)
 * - Respeita janela horária local (não captura fora do horário escolhido)
 * - Enfileira em AsyncStorage; drain via posicao-sync.ts
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationObject } from "expo-location";
import { showConfirm } from "./alert";

export const POSICAO_TASK = "ronan-posicao-periodica";
const CONFIG_LOCAL_KEY = "ronan.posicao-config-local";
const FILA_KEY = "ronan.posicoes-pendentes";

const INTERVALO_MS = 15 * 60_000; // 15 min
const ACCURACY_MAX_M = 200; // ignora fix muito ruim
const MAX_FILA = 200;

export type PosicaoConfigLocal = {
  ativada: boolean;
  horarioInicio: number | null;
  horarioFim: number | null;
};

export type PosicaoEnfileirada = {
  lat: number;
  lng: number;
  precisao?: number;
  velocidade?: number;
  capturadoEm: string;
};

let taskRegistrada = false;

/** Define a task background. Idempotente. Chamada no boot do _layout. */
export async function registerPosicaoTask(): Promise<void> {
  if (taskRegistrada) return;
  taskRegistrada = true;
  const TaskManager = await import("expo-task-manager");
  TaskManager.defineTask(POSICAO_TASK, async ({ data, error }) => {
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[posicao-task] erro:", error.message);
      return;
    }
    if (!data) return;
    const locations = (data as { locations?: LocationObject[] }).locations ?? [];
    if (locations.length === 0) return;

    // Defesa: lê config local; se motorista desativou no app mas a task
    // ainda recebeu uma última leitura, descarta.
    const cfg = await getConfigLocal();
    if (!cfg?.ativada) return;
    if (!dentroDaJanela(cfg)) return;

    const filtrados: PosicaoEnfileirada[] = locations
      .filter((l) => {
        const acc = l.coords.accuracy;
        return acc == null || acc <= ACCURACY_MAX_M;
      })
      .map((l) => ({
        lat: l.coords.latitude,
        lng: l.coords.longitude,
        precisao: l.coords.accuracy ?? undefined,
        velocidade: l.coords.speed ?? undefined,
        capturadoEm: new Date(l.timestamp).toISOString(),
      }));

    if (filtrados.length === 0) return;
    try {
      await enfileirar(filtrados);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[posicao-task] falhou append:", (err as Error).message);
    }
  });
}

/**
 * Inicia foreground service de captura periódica. Pede permissões com
 * pre-prompt explicativo (separado do tracking de viagem). Retorna false
 * se motorista negou permissão.
 */
export async function iniciarCapturaPeriodica(): Promise<boolean> {
  await registerPosicaoTask();
  const Location = await import("expo-location");

  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    const r = await Location.requestForegroundPermissionsAsync();
    if (r.status !== "granted") return false;
  }

  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status !== "granted") {
    const aceitou = await prePromptCompartilharPosicao();
    if (!aceitou) return false;
    const r = await Location.requestBackgroundPermissionsAsync();
    if (r.status !== "granted") return false;
  }

  // Se já tá rodando (configuração re-salva), para e re-inicia com novos params.
  const isRunning = await Location.hasStartedLocationUpdatesAsync(POSICAO_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(POSICAO_TASK);
  }

  await Location.startLocationUpdatesAsync(POSICAO_TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 0, // só por tempo, não por distância
    timeInterval: INTERVALO_MS,
    deferredUpdatesInterval: INTERVALO_MS,
    pausesUpdatesAutomatically: true, // economiza bateria quando parado
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Compartilhando posição",
      notificationBody: "Toque pra abrir o app e ajustar.",
      notificationColor: "#2563eb",
    },
  });
  return true;
}

export async function pararCapturaPeriodica(): Promise<void> {
  const Location = await import("expo-location");
  const isRunning = await Location.hasStartedLocationUpdatesAsync(POSICAO_TASK);
  if (isRunning) await Location.stopLocationUpdatesAsync(POSICAO_TASK);
}

export async function isCapturaPeriodicaAtiva(): Promise<boolean> {
  const Location = await import("expo-location");
  return Location.hasStartedLocationUpdatesAsync(POSICAO_TASK);
}

/** Snapshot da config pra task background ler sem fazer chamada HTTP. */
export async function setConfigLocal(cfg: PosicaoConfigLocal): Promise<void> {
  await AsyncStorage.setItem(CONFIG_LOCAL_KEY, JSON.stringify(cfg));
}

export async function getConfigLocal(): Promise<PosicaoConfigLocal | null> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_LOCAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PosicaoConfigLocal;
  } catch {
    return null;
  }
}

/**
 * Hora atual em Brasília (0-23). Ancorada em UTC-3 fixo — o Brasil acabou
 * com o horário de verão em 2019, então o offset é estável o ano todo.
 *
 * NÃO usar `new Date().getHours()`: isso lê a hora no fuso do APARELHO, e
 * já pegamos motorista com o celular num fuso errado (relógio absoluto certo,
 * mas timezone torto) — a janela abria/fechava com 3h de defasagem. Como a
 * spec define a janela em "hora local do Brasil", ancoramos em Brasília via
 * `getUTCHours()` (independente do fuso do device) menos 3.
 */
function horaBrasilia(): number {
  return (new Date().getUTCHours() - 3 + 24) % 24;
}

/**
 * Janela horária em hora de Brasília. Suporta passar madrugada (ex: 22h → 6h):
 * se fim < início, considera "fim+24h" no cálculo.
 */
export function dentroDaJanela(cfg: PosicaoConfigLocal): boolean {
  if (cfg.horarioInicio == null || cfg.horarioFim == null) return true; // 24/7
  const h = horaBrasilia();
  const inicio = cfg.horarioInicio;
  const fim = cfg.horarioFim;
  if (inicio === fim) return true;
  if (inicio < fim) return h >= inicio && h < fim;
  // Atravessa meia-noite: ex. 22-6
  return h >= inicio || h < fim;
}

// ===== Fila local de posições pendentes (sync via posicao-sync.ts) =====

export async function getFila(): Promise<PosicaoEnfileirada[]> {
  try {
    const raw = await AsyncStorage.getItem(FILA_KEY);
    return raw ? (JSON.parse(raw) as PosicaoEnfileirada[]) : [];
  } catch {
    return [];
  }
}

export async function setFila(items: PosicaoEnfileirada[]): Promise<void> {
  await AsyncStorage.setItem(FILA_KEY, JSON.stringify(items));
}

async function enfileirar(novas: PosicaoEnfileirada[]): Promise<void> {
  const fila = await getFila();
  const combinada = [...fila, ...novas].slice(-MAX_FILA);
  await setFila(combinada);
}

async function prePromptCompartilharPosicao(): Promise<boolean> {
  return showConfirm({
    title: "Permitir localização em segundo plano",
    message:
      'Pra enviar sua posição a cada ~15min (ajuda quando cliente pergunta cadê o material), o Android precisa de permissão "o tempo todo". Você pode desativar isso no app a qualquer momento. Na próxima tela, escolha "Permitir o tempo todo".',
    confirmLabel: "Continuar",
    cancelLabel: "Cancelar",
  });
}
