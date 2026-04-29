import { db, type PendingPedagio, type PendingViagem } from "@/db/dexie";
import { api } from "./api";

const MAX_ATTEMPTS = 8;

let draining = false;
const listeners = new Set<() => void>();

export function onSyncChange(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const l of listeners) l();
}

export async function enqueueViagem(
  payload: Record<string, unknown>,
  foto?: { blob: Blob; mime: string },
) {
  const clientId = payload.clientId as string;
  console.log("[sync] enqueueViagem", clientId, "online:", navigator.onLine, "hasFoto:", !!foto);
  await db.pendingViagens.put({
    clientId,
    payload,
    fotoBlob: foto?.blob,
    fotoMime: foto?.mime,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  console.log("[sync] enqueueViagem put OK", clientId);
  notify();
  void drain();
}

export async function enqueuePedagio(payload: Record<string, unknown>) {
  const clientId = payload.clientId as string;
  await db.pendingPedagios.put({
    clientId,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

export async function drain(): Promise<void> {
  if (draining) {
    console.log("[sync] drain skip (já rodando)");
    return;
  }
  if (!navigator.onLine) {
    console.log("[sync] drain skip (offline)");
    return;
  }
  console.log("[sync] drain start");
  draining = true;
  try {
    await drainViagens();
    await drainPedagios();
    console.log("[sync] drain done");
  } catch (err) {
    console.error("[sync] drain error", err);
  } finally {
    draining = false;
    notify();
  }
}

async function drainViagens() {
  const items = await db.pendingViagens.where("status").notEqual("syncing").toArray();
  for (const item of items) {
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!navigator.onLine) return;
    await processViagem(item);
  }
}

async function processViagem(item: PendingViagem) {
  console.log("[sync] viagem start", item.clientId, "hasFoto:", !!item.fotoBlob);
  await db.pendingViagens.update(item.clientId, { status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    let payload = { ...item.payload };
    if (item.fotoBlob && !payload.fotoKey) {
      const fd = new FormData();
      const filename = `ticket-${item.clientId}.${item.fotoMime?.includes("png") ? "png" : "jpg"}`;
      fd.append("foto", new File([item.fotoBlob], filename, { type: item.fotoMime ?? "image/jpeg" }));
      const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
      payload = { ...payload, fotoKey: up.storageKey };
      // marca foto como já subida pra não tentar de novo se viagem falhar
      await db.pendingViagens.update(item.clientId, {
        payload,
        fotoBlob: undefined,
        fotoMime: undefined,
      });
    }
    await api.post("/m/viagens", payload);
    console.log("[sync] viagem ok", item.clientId);
    await db.pendingViagens.delete(item.clientId);
  } catch (err) {
    console.error("[sync] viagem fail", item.clientId, err);
    await db.pendingViagens.update(item.clientId, {
      status: "error",
      errorMsg: (err as Error).message,
      attempts: (item.attempts ?? 0) + 1,
    });
  }
  notify();
}

async function drainPedagios() {
  const items = await db.pendingPedagios.where("status").notEqual("syncing").toArray();
  for (const item of items) {
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!navigator.onLine) return;
    await processPedagio(item);
  }
}

async function processPedagio(item: PendingPedagio) {
  await db.pendingPedagios.update(item.clientId, { status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    await api.post("/m/pedagios", item.payload);
    await db.pendingPedagios.delete(item.clientId);
  } catch (err) {
    await db.pendingPedagios.update(item.clientId, {
      status: "error",
      errorMsg: (err as Error).message,
      attempts: (item.attempts ?? 0) + 1,
    });
  }
  notify();
}

export function startAutoSync() {
  window.addEventListener("online", () => void drain());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void drain();
  });
  // tenta logo no boot caso sobrou pendente
  void drain();
  // retry periódico (modo defensivo)
  setInterval(() => void drain(), 60_000);
}

export async function pendingCount() {
  const [v, p] = await Promise.all([db.pendingViagens.count(), db.pendingPedagios.count()]);
  return v + p;
}
