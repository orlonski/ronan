import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  deletePendingAbastecimento,
  deletePendingPedagio,
  deletePendingViagem,
  listPendingAbastecimentos,
  listPendingPedagios,
  listPendingViagens,
  upsertPendingAbastecimento,
  upsertPendingPedagio,
  upsertPendingViagem,
  type PendingAbastecimento,
  type PendingPedagio,
  type PendingViagem,
  type ZodIssueSaved,
} from "@/db/database";
import { api, ApiError, humanizeApiError } from "./api";

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

/**
 * Erros 4xx do servidor são "permanentes" — não vão dar certo no retry.
 * Pra evitar 8 tentativas inúteis, marca como permanente (attempts =
 * MAX_ATTEMPTS) e o motorista resolve no app (editando ou descartando).
 *
 * Critério: ApiError com status 4xx, exceto 408/429 (timeout/rate limit
 * que podem se resolver com retry).
 */
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

/**
 * Apaga uma viagem pendente do outbox (motorista pode descartar antes
 * de sincronizar). Dispara notify pra UI re-renderizar.
 */
export async function descartarViagemPendente(clientId: string): Promise<void> {
  await deletePendingViagem(clientId);
  notify();
}

/**
 * Substitui payload/foto de uma viagem pendente existente (mesma clientId).
 * Usado quando o motorista edita uma viagem que ficou travada com erro.
 * Reseta attempts e status pra disparar nova tentativa imediata.
 *
 * Se a viagem sumiu (drain bem-sucedido entre abrir o form e salvar),
 * retorna { removed: true } pra UI poder avisar o motorista.
 */
export async function atualizarViagemPendente(input: {
  clientId: string;
  payload: Record<string, unknown>;
  foto?: { uri: string; mime: string };
}): Promise<{ removed: boolean }> {
  const list = await listPendingViagens();
  const existing = list.find((x) => x.clientId === input.clientId);
  if (!existing) return { removed: true };

  // Foto: se motorista mandou nova, usa nova; se não mandou, mantém o que tinha.
  const fotoUri = input.foto?.uri ?? existing.fotoUri;
  const fotoMime = input.foto?.mime ?? existing.fotoMime;

  await upsertPendingViagem({
    clientId: existing.clientId,
    payload: input.payload,
    fotoUri,
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

/**
 * Reseta o estado de erro de uma viagem pendente e dispara nova
 * tentativa de sync. Usa quando o motorista quer tentar de novo
 * após erro 4xx permanente (que parou os retries automáticos).
 */
export async function tentarNovamenteViagemPendente(
  clientId: string,
): Promise<void> {
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

export async function tentarNovamentePedagioPendente(
  clientId: string,
): Promise<void> {
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

export async function tentarNovamenteAbastecimentoPendente(
  clientId: string,
): Promise<void> {
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

export async function enqueueAbastecimento(
  payload: Record<string, unknown>,
  foto?: { uri: string; mime: string },
): Promise<void> {
  const clientId = payload.clientId as string;
  await upsertPendingAbastecimento({
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

export async function descartarAbastecimentoPendente(clientId: string): Promise<void> {
  await deletePendingAbastecimento(clientId);
  notify();
}

export async function pendingCounts(): Promise<{
  viagens: number;
  pedagios: number;
  abastecimentos: number;
  /** Itens com erro permanente (4xx) que precisam de ação do motorista. */
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
  const net = await NetInfo.fetch();
  if (!net.isConnected) return;
  draining = true;
  try {
    await drainViagens();
    await drainPedagios();
    await drainAbastecimentos();
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
    const permanente = isErroPermanente(err);
    const { msg, status, issues } = extractErrorDetails(err);
    await upsertPendingViagem({
      ...item,
      status: "error",
      errorMsg: msg,
      errorStatus: status,
      errorIssues: issues,
      // Erro permanente (4xx) marca como max attempts pra parar de tentar.
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
    const net = await NetInfo.fetch();
    if (!net.isConnected) return;
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
    if (item.fotoUri && !payload.fotoKey) {
      const fd = new FormData();
      const filename = `abast-${item.clientId}.${
        item.fotoMime?.includes("png") ? "png" : "jpg"
      }`;
      fd.append("foto", {
        uri: item.fotoUri,
        type: item.fotoMime ?? "image/jpeg",
        name: filename,
      } as unknown as Blob);
      const up = await api.postForm<{ storageKey: string }>(
        "/m/uploads/abastecimento",
        fd,
      );
      payload = { ...payload, fotoKey: up.storageKey };
      // Marca foto como já subida pra não tentar de novo se abast falhar depois
      await upsertPendingAbastecimento({
        ...item,
        payload,
        fotoUri: undefined,
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
