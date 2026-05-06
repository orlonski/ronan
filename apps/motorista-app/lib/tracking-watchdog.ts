/**
 * Background-fetch tasks que rodam de tempos em tempos (Android decide
 * a frequência, ~15-30 min):
 *
 * 1. AUTO_FINALIZAR_TASK — se há viagem em andamento E o último ponto
 *    é mais antigo que AUTO_FINALIZAR_HORAS, manda notificação pra
 *    motorista finalizar manualmente (não finaliza sozinho — só lembra).
 *
 * 2. DETECTOR_HIBRIDO_TASK — se NÃO há viagem em andamento E motorista
 *    está em movimento de carro (velocidade > 30 km/h por 3 leituras
 *    consecutivas), manda notificação "Esqueceu de iniciar viagem?".
 *
 * Background-fetch é "best effort" no Android — sistema decide quando
 * acordar. Não conta como fonte da verdade, é só lembrete.
 */
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { getViagemAndamento } from "./tracking-storage";
import { notificarLocal } from "./notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const WATCHDOG_TASK = "ronan-tracking-watchdog";
const HISTORICO_KEY = "ronan.detector-historico";
const AUTO_FINALIZAR_HORAS = 6;
const VELOCIDADE_LIMITE_KMH = 30;
const LEITURAS_PRA_DISPARAR = 3;

type DetectorEstado = {
  ultimaLeitura: { lat: number; lng: number; ts: number } | null;
  contadorMovimento: number;
  ultimoLembreteEm: number; // timestamp ms — debounce
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

TaskManager.defineTask(WATCHDOG_TASK, async () => {
  try {
    const viagem = await getViagemAndamento();

    // ----- 1. Auto-finalização: lembrete se 6h+ sem novo ponto -----
    if (viagem && viagem.pontos.length > 0) {
      const ultimoPonto = viagem.pontos[viagem.pontos.length - 1];
      if (ultimoPonto) {
        const horasSemPonto =
          (Date.now() - new Date(ultimoPonto.capturadoEm).getTime()) /
          (1000 * 60 * 60);
        if (horasSemPonto >= AUTO_FINALIZAR_HORAS) {
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
    if (!viagem) {
      const Location = await import("expo-location");
      const fg = await Location.getForegroundPermissionsAsync();
      if (fg.status !== "granted") return BackgroundFetch.BackgroundFetchResult.NoData;

      const pos = await Location.getLastKnownPositionAsync({
        maxAge: 5 * 60 * 1000, // 5 min
        requiredAccuracy: 200,
      });
      if (!pos) return BackgroundFetch.BackgroundFetchResult.NoData;

      const speedMs = pos.coords.speed ?? 0;
      const speedKmh = speedMs * 3.6;
      const estado = await getEstado();

      if (speedKmh > VELOCIDADE_LIMITE_KMH) {
        const novo: DetectorEstado = {
          ...estado,
          contadorMovimento: estado.contadorMovimento + 1,
          ultimaLeitura: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            ts: Date.now(),
          },
        };

        // 3 leituras consecutivas + debounce de 30 min entre lembretes
        const minutosDesdeUltimoLembrete =
          (Date.now() - estado.ultimoLembreteEm) / (1000 * 60);
        if (
          novo.contadorMovimento >= LEITURAS_PRA_DISPARAR &&
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
        // Reseta contador se parou de mover
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

export async function registrarWatchdog(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) return;
  if (status === BackgroundFetch.BackgroundFetchStatus.Denied) return;

  const isRegistered = await TaskManager.isTaskRegisteredAsync(WATCHDOG_TASK);
  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(WATCHDOG_TASK, {
    minimumInterval: 15 * 60, // 15 min — Android pode atrasar
    stopOnTerminate: false,
    startOnBoot: true,
  });
}
