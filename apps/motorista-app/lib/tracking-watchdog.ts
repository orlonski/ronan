/**
 * Background-fetch tasks que rodam de tempos em tempos (Android decide
 * a frequência, ~15-30 min):
 *
 * 1. AUTO_FINALIZAR — se há viagem em andamento E o último ponto é
 *    mais antigo que AUTO_FINALIZAR_HORAS, manda notificação pra
 *    motorista finalizar manualmente.
 *
 * 2. DETECTOR_HIBRIDO — se NÃO há viagem em andamento E motorista
 *    está em movimento de carro (velocidade > 30 km/h por 3 leituras
 *    consecutivas), manda notificação "Esqueceu de iniciar viagem?".
 *
 * IMPORTANTE: imports nativos top-level quebram o boot do expo-router
 * ("Objects are not valid as a React child"). Por isso TUDO aqui usa
 * lazy `await import(...)` dentro de função.
 *
 * Background-fetch é "best effort" no Android — sistema decide quando
 * acordar. Não conta como fonte da verdade, é só lembrete.
 */
import { getViagemAndamento } from "./tracking-storage";
import { notificarLocal } from "./notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const WATCHDOG_TASK = "ronan-tracking-watchdog";
const HISTORICO_KEY = "ronan.detector-historico";
const CONFIG_CACHE_KEY = "q:tracking-config";

// Defaults caso a config server-side esteja indisponível
const DEFAULT_AUTO_FINALIZAR_HORAS = 6;
const DEFAULT_VELOCIDADE_LIMITE_KMH = 30;
const DEFAULT_LEITURAS_PRA_DISPARAR = 3;
const DEFAULT_DETECTOR_ATIVADO = true;

type TrackingCfg = {
  autoFinalizarHoras?: number;
  detectorAtivado?: boolean;
  detectorVelocidadeKmh?: number;
  detectorLeituras?: number;
};

async function getCachedConfig(): Promise<TrackingCfg> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_CACHE_KEY);
    if (raw) return JSON.parse(raw) as TrackingCfg;
  } catch {
    /* ignora */
  }
  return {};
}

type DetectorEstado = {
  ultimaLeitura: { lat: number; lng: number; ts: number } | null;
  contadorMovimento: number;
  ultimoLembreteEm: number;
};

async function getEstado(): Promise<DetectorEstado> {
  try {
    const raw = await AsyncStorage.getItem(HISTORICO_KEY);
    if (raw) return JSON.parse(raw) as DetectorEstado;
  } catch {
    /* ignora */
  }
  return { ultimaLeitura: null, contadorMovimento: 0, ultimoLembreteEm: 0 };
}

async function setEstado(e: DetectorEstado): Promise<void> {
  await AsyncStorage.setItem(HISTORICO_KEY, JSON.stringify(e));
}

let registered = false;

async function defineWatchdogTask(): Promise<void> {
  if (registered) return;
  registered = true;
  const TaskManager = await import("expo-task-manager");
  const BackgroundFetch = await import("expo-background-fetch");

  TaskManager.defineTask(WATCHDOG_TASK, async () => {
    try {
      // Piggyback: sync em background (catálogos + fila) nesta mesma task, pra
      // não registrar uma 2ª background-fetch (iOS roda ~1 por app). Fecha o
      // furo do motorista que só abre o app em área sem sinal.
      try {
        const { sincronizarEmBackground } = await import("./sync-background");
        await sincronizarEmBackground();
      } catch {
        /* best-effort — não atrapalha a lógica do watchdog abaixo */
      }

      const viagem = await getViagemAndamento();
      const cfg = await getCachedConfig();
      const autoFinalizarHoras =
        cfg.autoFinalizarHoras ?? DEFAULT_AUTO_FINALIZAR_HORAS;
      const detectorAtivado =
        cfg.detectorAtivado ?? DEFAULT_DETECTOR_ATIVADO;
      const velocidadeLimiteKmh =
        cfg.detectorVelocidadeKmh ?? DEFAULT_VELOCIDADE_LIMITE_KMH;
      const leiturasPraDisparar =
        cfg.detectorLeituras ?? DEFAULT_LEITURAS_PRA_DISPARAR;

      // ----- 1. Auto-finalização: lembrete se Nh+ sem novo ponto -----
      if (viagem && viagem.pontos.length > 0) {
        const ultimoPonto = viagem.pontos[viagem.pontos.length - 1];
        if (ultimoPonto) {
          const horasSemPonto =
            (Date.now() - new Date(ultimoPonto.capturadoEm).getTime()) /
            (1000 * 60 * 60);
          if (horasSemPonto >= autoFinalizarHoras) {
            await notificarLocal(
              "Viagem ainda em andamento?",
              `Faz ${horasSemPonto.toFixed(0)}h que não capturamos GPS. Toque pra finalizar.`,
              { kind: "auto-finalizar" },
            );
            return BackgroundFetch.BackgroundFetchResult.NewData;
          }
        }
      }

      // ----- 2. Detector híbrido: lembrete se em movimento sem tracking -----
      if (!viagem && detectorAtivado) {
        const Location = await import("expo-location");
        const fg = await Location.getForegroundPermissionsAsync();
        if (fg.status !== "granted")
          return BackgroundFetch.BackgroundFetchResult.NoData;

        const pos = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,
          requiredAccuracy: 200,
        });
        if (!pos) return BackgroundFetch.BackgroundFetchResult.NoData;

        const speedMs = pos.coords.speed ?? 0;
        const speedKmh = speedMs * 3.6;
        const estado = await getEstado();

        if (speedKmh > velocidadeLimiteKmh) {
          const novo: DetectorEstado = {
            ...estado,
            contadorMovimento: estado.contadorMovimento + 1,
            ultimaLeitura: {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              ts: Date.now(),
            },
          };
          const minutosDesdeUltimoLembrete =
            (Date.now() - estado.ultimoLembreteEm) / (1000 * 60);
          if (
            novo.contadorMovimento >= leiturasPraDisparar &&
            minutosDesdeUltimoLembrete > 30
          ) {
            await notificarLocal(
              "Esqueceu de iniciar viagem?",
              "Detectamos movimento de carro. Toque pra rastrear o trajeto.",
              { kind: "iniciar-tracking" },
            );
            novo.ultimoLembreteEm = Date.now();
            novo.contadorMovimento = 0;
          }
          await setEstado(novo);
        } else {
          if (estado.contadorMovimento > 0) {
            await setEstado({ ...estado, contadorMovimento: 0 });
          }
        }
        return BackgroundFetch.BackgroundFetchResult.NewData;
      }

      return BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[watchdog] falhou:", (err as Error).message);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

export async function registrarWatchdog(): Promise<void> {
  try {
    await defineWatchdogTask();

    const BackgroundFetch = await import("expo-background-fetch");
    const TaskManager = await import("expo-task-manager");

    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) return;
    if (status === BackgroundFetch.BackgroundFetchStatus.Denied) return;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(WATCHDOG_TASK);
    if (isRegistered) return;

    await BackgroundFetch.registerTaskAsync(WATCHDOG_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch {
    /* watchdog opcional — falhar nao bloqueia o app */
  }
}
