// Storage simples key-value via AsyncStorage.
// Volume real é baixo (cache de catálogos + outbox de poucas viagens),
// AsyncStorage é mais robusto e estável que SQLite no Expo Go.
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "ronan.";

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`${PREFIX}cache.${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v: T; t: number };
    return parsed.v;
  } catch {
    return null;
  }
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${PREFIX}cache.${key}`,
      JSON.stringify({ v: value, t: Date.now() }),
    );
  } catch {
    /* sem espaco / corrupted — ignora silenciosamente */
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${PREFIX}cache.${key}`);
  } catch {
    /* nope */
  }
}

// Outbox helpers: lista única de pending por tipo, persistida como JSON.
// Volume baixo (motorista lança poucas viagens por dia), tudo na memória.

export type ZodIssueSaved = {
  path: string;
  code: string;
  message: string;
};

export type PendingViagem = {
  clientId: string;
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

export type PendingPedagio = {
  clientId: string;
  payload: Record<string, unknown>;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

export type PendingAbastecimento = {
  clientId: string;
  payload: Record<string, unknown>;
  fotoUri?: string;
  fotoMime?: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

/** Foto a anexar em viagem JÁ sincronizada. Motorista esqueceu de anexar
 * no lançamento; abre a tela de detalhe da viagem e adiciona depois.
 * viagemId é o id real do servidor (viagem precisa existir lá). */
export type PendingFoto = {
  /** UUID gerado client-side pra identificar essa pending. */
  clientId: string;
  viagemId: string;
  fotoUri: string;
  fotoMime: string;
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

/** Local de descarga criado offline. clientId vira id real no servidor
 * (POST /m/locais/rapido aceita id pra idempotência). */
export type PendingLocal = {
  clientId: string;
  payload: {
    nome: string;
    lat: number;
    lng: number;
    tipo: "CARGA" | "DESCARGA" | "AMBOS";
    clienteIds?: string[];
  };
  status: "pending" | "syncing" | "error";
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

const VIAGENS_KEY = `${PREFIX}outbox.viagens`;
const PEDAGIOS_KEY = `${PREFIX}outbox.pedagios`;
const ABASTECIMENTOS_KEY = `${PREFIX}outbox.abastecimentos`;
const LOCAIS_KEY = `${PREFIX}outbox.locais`;
const FOTOS_KEY = `${PREFIX}outbox.fotos`;

async function readList<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeList<T>(key: string, list: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(list));
}

export async function listPendingViagens(): Promise<PendingViagem[]> {
  return readList<PendingViagem>(VIAGENS_KEY);
}

export async function listPendingPedagios(): Promise<PendingPedagio[]> {
  return readList<PendingPedagio>(PEDAGIOS_KEY);
}

export async function upsertPendingViagem(item: PendingViagem): Promise<void> {
  const list = await listPendingViagens();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(VIAGENS_KEY, list);
}

export async function upsertPendingPedagio(item: PendingPedagio): Promise<void> {
  const list = await listPendingPedagios();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(PEDAGIOS_KEY, list);
}

export async function deletePendingViagem(clientId: string): Promise<void> {
  const list = await listPendingViagens();
  await writeList(
    VIAGENS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function deletePendingPedagio(clientId: string): Promise<void> {
  const list = await listPendingPedagios();
  await writeList(
    PEDAGIOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingAbastecimentos(): Promise<PendingAbastecimento[]> {
  return readList<PendingAbastecimento>(ABASTECIMENTOS_KEY);
}

export async function upsertPendingAbastecimento(
  item: PendingAbastecimento,
): Promise<void> {
  const list = await listPendingAbastecimentos();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(ABASTECIMENTOS_KEY, list);
}

export async function deletePendingAbastecimento(clientId: string): Promise<void> {
  const list = await listPendingAbastecimentos();
  await writeList(
    ABASTECIMENTOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingLocais(): Promise<PendingLocal[]> {
  return readList<PendingLocal>(LOCAIS_KEY);
}

export async function upsertPendingLocal(item: PendingLocal): Promise<void> {
  const list = await listPendingLocais();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(LOCAIS_KEY, list);
}

export async function deletePendingLocal(clientId: string): Promise<void> {
  const list = await listPendingLocais();
  await writeList(
    LOCAIS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}

export async function listPendingFotos(): Promise<PendingFoto[]> {
  return readList<PendingFoto>(FOTOS_KEY);
}

export async function upsertPendingFoto(item: PendingFoto): Promise<void> {
  const list = await listPendingFotos();
  const idx = list.findIndex((x) => x.clientId === item.clientId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  await writeList(FOTOS_KEY, list);
}

export async function deletePendingFoto(clientId: string): Promise<void> {
  const list = await listPendingFotos();
  await writeList(
    FOTOS_KEY,
    list.filter((x) => x.clientId !== clientId),
  );
}
