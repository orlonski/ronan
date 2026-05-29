import {
  deletePendingAbastecimento,
  deletePendingLocal,
  deletePendingPedagio,
  deletePendingViagem,
  listPendingAbastecimentos,
  listPendingLocais,
  listPendingPedagios,
  listPendingViagens,
  upsertPendingAbastecimento,
  upsertPendingLocal,
  upsertPendingPedagio,
  upsertPendingViagem,
  type PendingAbastecimento,
  type PendingLocal,
  type PendingPedagio,
  type PendingViagem,
  type ZodIssueSaved,
} from "@/db/dexie";
import { api, ApiError, humanizeApiError } from "./api";
import { reportarEvento } from "./event-reporter";

type ApiErrorBody = { issues?: ZodIssueSaved[] };

function extractErrorDetails(err: unknown): {
  msg: string;
  status?: number;
  issues?: ZodIssueSaved[];
} {
  const msg = humanizeApiError(err);
  if (err instanceof ApiError) {
    const body = err.body as ApiErrorBody | null;
    const issues = Array.isArray(body?.issues) ? body!.issues : undefined;
    return { msg, status: err.status, issues };
  }
  return { msg };
}

const MAX_ATTEMPTS = 8;

/** Tempo após o qual um item com status="syncing" é considerado órfão.
 *  Espelha o motorista-app — ver doc lá. */
const STALE_SYNCING_MS = 5 * 60 * 1000;

function isErroPermanente(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status >= 500) return false;
  if (err.status === 408 || err.status === 429) return false;
  return err.status >= 400 && err.status < 500;
}

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

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

// ===== Viagens =====

export async function descartarViagemPendente(clientId: string): Promise<void> {
  await deletePendingViagem(clientId);
  notify();
}

export async function atualizarViagemPendente(input: {
  clientId: string;
  payload: Record<string, unknown>;
  foto?: { blob: Blob; mime: string };
}): Promise<{ removed: boolean }> {
  const list = await listPendingViagens();
  const existing = list.find((x) => x.clientId === input.clientId);
  if (!existing) return { removed: true };

  const fotoBlob = input.foto?.blob ?? existing.fotoBlob;
  const fotoMime = input.foto?.mime ?? existing.fotoMime;

  await upsertPendingViagem({
    clientId: existing.clientId,
    payload: input.payload,
    fotoBlob,
    fotoMime,
    status: "pending",
    attempts: 0,
    createdAt: existing.createdAt,
    lastTriedAt: undefined,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
  return { removed: false };
}

export async function tentarNovamenteViagemPendente(clientId: string): Promise<void> {
  const list = await listPendingViagens();
  const item = list.find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingViagem({
    ...item,
    status: "pending",
    attempts: 0,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
}

export async function tentarNovamentePedagioPendente(clientId: string): Promise<void> {
  const list = await listPendingPedagios();
  const item = list.find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingPedagio({
    ...item,
    status: "pending",
    attempts: 0,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
}

export async function tentarNovamenteAbastecimentoPendente(clientId: string): Promise<void> {
  const list = await listPendingAbastecimentos();
  const item = list.find((x) => x.clientId === clientId);
  if (!item) return;
  await upsertPendingAbastecimento({
    ...item,
    status: "pending",
    attempts: 0,
    errorMsg: undefined,
    errorStatus: undefined,
    errorIssues: undefined,
  });
  notify();
  void drain();
}

export async function enqueueViagem(
  payload: Record<string, unknown>,
  foto?: { blob: Blob; mime: string },
): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingViagem({
    clientId,
    payload,
    fotoBlob: foto?.blob,
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

export async function enqueueAbastecimento(
  payload: Record<string, unknown>,
  foto?: { blob: Blob; mime: string },
): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingAbastecimento({
    clientId,
    payload,
    fotoBlob: foto?.blob,
    fotoMime: foto?.mime,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
  notify();
  void drain();
}

/** Local criado offline. clientId vira id real no servidor (idempotência). */
export async function enqueueLocal(item: PendingLocal): Promise<void> {
  await upsertPendingLocal(item);
  void reportarEvento("local_criado", {
    nome: item.payload.nome,
    lat: item.payload.lat,
    lng: item.payload.lng,
    tipo: item.payload.tipo,
  });
  notify();
  void drain();
}

export async function descartarPedagioPendente(clientId: string): Promise<void> {
  await deletePendingPedagio(clientId);
  notify();
}

export async function descartarAbastecimentoPendente(clientId: string): Promise<void> {
  await deletePendingAbastecimento(clientId);
  notify();
}

export async function pendingCounts(): Promise<{
  viagens: number;
  pedagios: number;
  abastecimentos: number;
  comErro: number;
}> {
  const [v, p, a] = await Promise.all([
    listPendingViagens(),
    listPendingPedagios(),
    listPendingAbastecimentos(),
  ]);
  const comErro =
    v.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    p.filter((i) => i.attempts >= MAX_ATTEMPTS).length +
    a.filter((i) => i.attempts >= MAX_ATTEMPTS).length;
  return {
    viagens: v.length,
    pedagios: p.length,
    abastecimentos: a.length,
    comErro,
  };
}

export async function drain(): Promise<void> {
  if (draining) return;
  if (!isOnline()) return;
  draining = true;
  try {
    // Destrava itens com status="syncing" órfão de drain anterior morto
    // no meio do envio. Backend idempotente — retry seguro.
    await rescueStaleItems();
    // Locais ANTES de viagens: viagens podem ter localDescargaId apontando
    // pra um local pendente. Se a viagem chegar primeiro, FK violation.
    await drainLocais();
    await drainViagens();
    await drainPedagios();
    await drainAbastecimentos();
  } finally {
    draining = false;
    notify();
  }
}

async function rescueStaleItems(): Promise<void> {
  const limite = Date.now() - STALE_SYNCING_MS;
  const isStale = (lastTriedAt?: number) =>
    !lastTriedAt || lastTriedAt < limite;

  for (const v of await listPendingViagens()) {
    if (v.status === "syncing" && isStale(v.lastTriedAt)) {
      await upsertPendingViagem({ ...v, status: "pending" });
    }
  }
  for (const l of await listPendingLocais()) {
    if (l.status === "syncing" && isStale(l.lastTriedAt)) {
      await upsertPendingLocal({ ...l, status: "pending" });
    }
  }
  for (const p of await listPendingPedagios()) {
    if (p.status === "syncing" && isStale(p.lastTriedAt)) {
      await upsertPendingPedagio({ ...p, status: "pending" });
    }
  }
  for (const a of await listPendingAbastecimentos()) {
    if (a.status === "syncing" && isStale(a.lastTriedAt)) {
      await upsertPendingAbastecimento({ ...a, status: "pending" });
    }
  }
}

async function drainLocais(): Promise<void> {
  const list = await listPendingLocais();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!isOnline()) return;
    await processLocal(item);
  }
}

async function processLocal(item: PendingLocal): Promise<void> {
  await upsertPendingLocal({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    await api.post("/m/locais/rapido", { id: item.clientId, ...item.payload });
    await deletePendingLocal(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingLocal({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
  }
  notify();
}

async function drainViagens(): Promise<void> {
  const list = await listPendingViagens();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!isOnline()) return;
    await processViagem(item);
  }
}

function buildFotoFormData(prefix: string, clientId: string, blob: Blob, mime: string): FormData {
  const fd = new FormData();
  const ext = mime.includes("png") ? "png" : "jpg";
  const filename = `${prefix}-${clientId}.${ext}`;
  fd.append("foto", new File([blob], filename, { type: mime }));
  return fd;
}

async function processViagem(item: PendingViagem): Promise<void> {
  await upsertPendingViagem({ ...item, status: "syncing", lastTriedAt: Date.now() });
  notify();
  try {
    let payload = { ...item.payload };
    if (item.fotoBlob && !payload.fotoKey) {
      const fd = buildFotoFormData("ticket", item.clientId, item.fotoBlob, item.fotoMime ?? "image/jpeg");
      const up = await api.postForm<{ storageKey: string }>("/m/uploads/ticket", fd);
      payload = { ...payload, fotoKey: up.storageKey };
      await upsertPendingViagem({
        ...item,
        payload,
        fotoBlob: undefined,
        fotoMime: undefined,
        status: "syncing",
      });
    }
    await api.post("/m/viagens", payload);
    await deletePendingViagem(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingViagem({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
  }
  notify();
}

async function drainPedagios(): Promise<void> {
  const list = await listPendingPedagios();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!isOnline()) return;
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
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingPedagio({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
  }
  notify();
}

async function drainAbastecimentos(): Promise<void> {
  const list = await listPendingAbastecimentos();
  for (const item of list) {
    if (item.status === "syncing") continue;
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (!isOnline()) return;
    await processAbastecimento(item);
  }
}

async function processAbastecimento(item: PendingAbastecimento): Promise<void> {
  await upsertPendingAbastecimento({
    ...item,
    status: "syncing",
    lastTriedAt: Date.now(),
  });
  notify();
  try {
    let payload = { ...item.payload };
    if (item.fotoBlob && !payload.fotoKey) {
      const fd = buildFotoFormData("abast", item.clientId, item.fotoBlob, item.fotoMime ?? "image/jpeg");
      const up = await api.postForm<{ storageKey: string }>("/m/uploads/abastecimento", fd);
      payload = { ...payload, fotoKey: up.storageKey };
      await upsertPendingAbastecimento({
        ...item,
        payload,
        fotoBlob: undefined,
        fotoMime: undefined,
        status: "syncing",
      });
    }
    await api.post("/m/abastecimentos", payload);
    await deletePendingAbastecimento(item.clientId);
  } catch (err) {
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingAbastecimento({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      attempts: permanente ? MAX_ATTEMPTS : item.attempts + 1,
    });
  }
  notify();
}

let autoSyncStarted = false;

export function startAutoSync(): void {
  if (autoSyncStarted) return;
  if (typeof window === "undefined") return;
  autoSyncStarted = true;

  window.addEventListener("online", () => {
    void drain();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void drain();
  });

  // pageshow dispara também em iOS quando volta do bfcache.
  window.addEventListener("pageshow", () => {
    void drain();
  });

  setInterval(() => {
    void drain();
  }, 60_000);

  setTimeout(() => {
    void drain();
  }, 2_000);
}
