import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  deletePendingPedagio,
  deletePendingViagem,
  listPendingPedagios,
  listPendingViagens,
  upsertPendingPedagio,
  upsertPendingViagem,
  type PendingPedagio,
  type PendingViagem,
} from "@/db/database";
import { api } from "./api";

const MAX_ATTEMPTS = 8;

let draining = false;
const listeners = new Set<() => void>();

export function onSyncChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

/**
 * Apaga uma viagem pendente do outbox (motorista pode descartar antes
 * de sincronizar). Dispara notify pra UI re-renderizar.
 */
export async function descartarViagemPendente(clientId: string): Promise<void> {
  await deletePendingViagem(clientId);
  notify();
}

export async function enqueueViagem(
  payload: Record<string, unknown>,
  foto?: { uri: string; mime: string },
): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingViagem({
    clientId,
    payload,
    fotoUri: foto?.uri,
    fotoMime: foto?.mime,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

export async function enqueuePedagio(payload: Record<string, unknown>): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingPedagio({
    clientId,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

export async function pendingCounts(): Promise<{ viagens: number; pedagios: number }> {
  const [v, p] = await Promise.all([listPendingViagens(), listPendingPedagios()]);
  return { viagens: v.length, pedagios: p.length };
}

export async function drain(): Promise<void> {
  if (draining) return;
  const net = await NetInfo.fetch();
  if (!net.isConnected) return;
  draining = true;
  try {
    await drainViagens();
    await drainPedagios();
  } finally {
    draining = false;
    notify();
  }
}

async function drainViagens(): Promise<void> {
  const list = await listPendingViagens();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    const net = await NetInfo.fetch();
    if (!net.isConnected) return;
    await processViagem(item);
  }
}

async function processViagem(item: PendingViagem): Promise<void> {
  await upsertPendingViagem({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    let payload = { ...item.payload };
    if (item.fotoUri && !payload.fotoKey) {
      const fd = new FormData();
      const filename = `ticket-${item.clientId}.${
        item.fotoMime?.includes("png") ? "png" : "jpg"
      }`;
      fd.append("foto", {
        uri: item.fotoUri,
        type: item.fotoMime ?? "image/jpeg",
        name: filename,
      } as unknown as Blob);
      const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
      payload = { ...payload, fotoKey: up.storageKey };
      // Marca foto como já subida pra não tentar de novo se viagem falhar depois
      await upsertPendingViagem({
        ...item,
        payload,
        fotoUri: undefined,
        fotoMime: undefined,
        status: "syncing",
      });
    }
    await api.post("/m/viagens", payload);
    await deletePendingViagem(item.clientId);
  } catch (err) {
    await upsertPendingViagem({
      ...item,
      status: "error",
      errorMsg: (err as Error).message ?? String(err),
      attempts: item.attempts + 1,
    });
  }
  notify();
}

async function drainPedagios(): Promise<void> {
  const list = await listPendingPedagios();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    const net = await NetInfo.fetch();
    if (!net.isConnected) return;
    await processPedagio(item);
  }
}

async function processPedagio(item: PendingPedagio): Promise<void> {
  await upsertPendingPedagio({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    await api.post("/m/pedagios", item.payload);
    await deletePendingPedagio(item.clientId);
  } catch (err) {
    await upsertPendingPedagio({
      ...item,
      status: "error",
      errorMsg: (err as Error).message ?? String(err),
      attempts: item.attempts + 1,
    });
  }
  notify();
}

let autoSyncStarted = false;

export function startAutoSync(): void {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  NetInfo.addEventListener((state) => {
    if (state.isConnected) void drain();
  });

  AppState.addEventListener("change", (s) => {
    if (s === "active") void drain();
  });

  setInterval(() => {
    void drain();
  }, 60_000);

  // Boot: dispara depois de 2s pra dar tempo de tudo inicializar.
  setTimeout(() => {
    void drain();
  }, 2_000);
}
