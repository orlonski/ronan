/**
 * Geofence passivo pra validar locais cadastrados pelo motorista sem
 * depender de "Iniciar viagem". OS (Android/iOS) monitora as regiões usando
 * o GPS que já roda pra outras apps — custo de bateria praticamente zero.
 *
 * Fluxo:
 *   1. App faz GET /m/locais/em-validacao e registra geofences (até 20).
 *   2. OS dispara ENTER → guardamos timestamp em AsyncStorage.
 *   3. OS dispara EXIT → calculamos dwell. Se ≥ 600s, enfileira evento.
 *   4. Fila é drenada via POST /m/locais/:id/eventos-presenca quando online.
 *
 * Imports nativos são lazy (mesmo padrão de tracking-task.ts) pra não
 * quebrar o boot do expo-router.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, ApiError } from "./api";
import type { LocalEmValidacao } from "./queries";

export const GEOFENCE_TASK = "ronan-geofence-locais";

const ENTERS_KEY = "ronan.geofence-enters"; // { [localId]: enterAtMs }
const FILA_KEY = "ronan.geofence-fila"; // EventoPendente[]
const REGIONS_KEY = "ronan.geofence-regions"; // identifiers atuais (debug)

const RAIO_M = 200;
const DWELL_MIN_SEG = 600; // 10 min

type EnterMap = Record<string, number>;

type EventoPendente = {
  localId: string;
  duracaoSeg: number;
  detectadoEm: string; // ISO
};

let defined = false;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignora */
  }
  return fallback;
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignora */
  }
}

/**
 * Define a task que o OS chama quando entra/sai dum geofence. Precisa rodar
 * no boot do app antes do startGeofencingAsync — mesmo padrão de
 * tracking-task.ts. defineTask top-level com import nativo quebra
 * expo-router (Objects are not valid as a React child).
 */
export async function registerGeofenceTask(): Promise<void> {
  if (defined) return;
  defined = true;
  const TaskManager = await import("expo-task-manager");
  const Location = await import("expo-location");

  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[geofence] task error:", error.message);
      return;
    }
    if (!data) return;
    const payload = data as {
      eventType: number;
      region: { identifier: string };
    };
    const localId = payload.region?.identifier;
    if (!localId) return;

    if (payload.eventType === Location.GeofencingEventType.Enter) {
      const enters = await readJson<EnterMap>(ENTERS_KEY, {});
      enters[localId] = Date.now();
      await writeJson(ENTERS_KEY, enters);
      return;
    }

    if (payload.eventType === Location.GeofencingEventType.Exit) {
      const enters = await readJson<EnterMap>(ENTERS_KEY, {});
      const enterAt = enters[localId];
      if (!enterAt) return; // EXIT sem ENTER prévio (boot, app reinstalado) — ignora
      const duracaoSeg = Math.round((Date.now() - enterAt) / 1000);
      delete enters[localId];
      await writeJson(ENTERS_KEY, enters);

      if (duracaoSeg < DWELL_MIN_SEG) return; // parada curta, não é dwell

      const detectadoEm = new Date().toISOString();
      const fila = await readJson<EventoPendente[]>(FILA_KEY, []);
      fila.push({ localId, duracaoSeg, detectadoEm });
      await writeJson(FILA_KEY, fila);
      // Tenta drenar agora — se offline, fica pra próxima oportunidade.
      void drenarFila();
    }
  });
}

/**
 * Busca locais em validação no backend e registra como geofences ativos.
 * Substitui o conjunto inteiro a cada chamada — locais já validados
 * (RECORRENTE/HUMANO) saem automaticamente. Falhas (sem permissão, offline)
 * são silenciosas.
 */
export async function sincronizarGeofences(): Promise<void> {
  try {
    await registerGeofenceTask();

    const Location = await import("expo-location");
    const TaskManager = await import("expo-task-manager");

    // Sem permissão de background não tem como — silencioso, motorista
    // pode aceitar depois.
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== "granted") return;
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status !== "granted") return;

    const locais = await api
      .get<LocalEmValidacao[]>("/m/locais/em-validacao")
      .catch(() => null);
    if (!locais) return;

    const regioes = locais
      .filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lng))
      .slice(0, 20) // limite iOS
      .map((l) => ({
        identifier: l.id,
        latitude: l.lat,
        longitude: l.lng,
        radius: RAIO_M,
        notifyOnEnter: true,
        notifyOnExit: true,
      }));

    const registered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);

    if (regioes.length === 0) {
      if (registered) {
        await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
      }
      await writeJson(REGIONS_KEY, []);
      return;
    }

    // Re-registra o conjunto (Expo permite chamar várias vezes; substitui)
    if (registered) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
    }
    await Location.startGeofencingAsync(GEOFENCE_TASK, regioes);
    await writeJson(
      REGIONS_KEY,
      regioes.map((r) => r.identifier),
    );

    // Aproveita o boot/sync pra drenar a fila offline.
    void drenarFila();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[geofence] sincronizar falhou:", (err as Error).message);
  }
}

/**
 * Envia eventos de dwell pendentes pro backend. Chamado no boot, depois de
 * sincronizar, e logo após cada EXIT detectado. Se servidor retornar 4xx
 * pra um evento específico, ele é descartado (não bloqueia os demais).
 */
export async function drenarFila(): Promise<void> {
  const fila = await readJson<EventoPendente[]>(FILA_KEY, []);
  if (fila.length === 0) return;

  const sobrou: EventoPendente[] = [];
  for (const evento of fila) {
    try {
      await api.post(`/m/locais/${evento.localId}/eventos-presenca`, {
        duracaoSeg: evento.duracaoSeg,
        detectadoEm: evento.detectadoEm,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // Erro de validação / local inexistente — descarta.
        continue;
      }
      // Rede ou 5xx — mantém pra tentar depois.
      sobrou.push(evento);
    }
  }
  await writeJson(FILA_KEY, sobrou);
}
