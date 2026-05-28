/**
 * Telemetria de operação do motorista. Captura eventos semânticos (não
 * erros JS — pra isso tem error-reporter) e envia em batch pro backend.
 *
 * Padrão imperativo: `reportarEvento(tipo, contexto)`. Fila local em
 * AsyncStorage com cap pra suportar offline. Drena automaticamente quando
 * tem conexão (chamado pelo startAutoSync em sync.ts).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";
import type { TipoEvento } from "@ronan/shared-types";
import { api } from "./api";
import { loadTokens } from "./auth";

const STORAGE_KEY = "ronan.eventos-pendentes";
const MAX_PENDENTES = 200;
const BATCH_SIZE = 50;

type EventoPendente = {
  id: string;
  tipo: string;
  contexto: Record<string, unknown>;
  online: boolean;
  versaoApp?: string;
  capturadoEm: string;
  viagemClientId?: string;
};

let inFlight = false;

/**
 * Enfileira um evento e tenta drenar. Fire-and-forget — nunca lança.
 */
export async function reportarEvento(
  tipo: TipoEvento | string,
  contexto: Record<string, unknown>,
  opts?: { viagemClientId?: string },
): Promise<void> {
  try {
    const online = await checarOnline();
    const evento: EventoPendente = {
      id: gerarUuid(),
      tipo,
      contexto,
      online,
      versaoApp: getVersao(),
      capturadoEm: new Date().toISOString(),
      viagemClientId: opts?.viagemClientId,
    };
    await adicionarPendente(evento);
    void drenar();
  } catch {
    /* silencioso — reporter nunca quebra o app */
  }
}

/**
 * Drena a fila local enviando batches pro backend. Chamado por:
 * - reportarEvento (após enfileirar)
 * - startAutoSync (NetInfo + interval)
 * - manualmente em momentos chave (após login)
 */
export async function drenar(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const tokens = await loadTokens();
    if (!tokens?.accessToken) return;

    let pendentes = await getPendentes();
    while (pendentes.length > 0) {
      const batch = pendentes.slice(0, BATCH_SIZE);
      try {
        await api.post(
          "/m/eventos?origem=motorista-app",
          { eventos: batch },
        );
      } catch {
        // Provavelmente offline ou servidor instável — para o loop, mantém na fila.
        return;
      }
      pendentes = pendentes.slice(batch.length);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pendentes));
    }
  } finally {
    inFlight = false;
  }
}

async function getPendentes(): Promise<EventoPendente[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EventoPendente[]) : [];
  } catch {
    return [];
  }
}

async function adicionarPendente(e: EventoPendente): Promise<void> {
  const cur = await getPendentes();
  cur.push(e);
  const trimmed = cur.slice(-MAX_PENDENTES);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

async function checarOnline(): Promise<boolean> {
  try {
    const net = await NetInfo.fetch();
    return !!net.isConnected;
  } catch {
    return true; // melhor reportar como online do que dizer falso offline
  }
}

function getVersao(): string {
  const ver = Constants.expoConfig?.version ?? "?";
  const update = Constants.expoConfig?.runtimeVersion ?? "?";
  return `${ver}+${update}`;
}

function gerarUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
