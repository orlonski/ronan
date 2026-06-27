import Dexie, { type EntityTable } from "dexie";

export type SyncStatus = "pending" | "syncing" | "error";

export type ZodIssueSaved = {
  path: string;
  code: string;
  message: string;
};

export type PendingViagem = {
  clientId: string;
  payload: Record<string, unknown>;
  fotoBlob?: Blob;
  fotoMime?: string;
  status: SyncStatus;
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
  status: SyncStatus;
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
  fotoBlob?: Blob;
  fotoMime?: string;
  status: SyncStatus;
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

/** Foto a anexar em viagem JÁ sincronizada (motorista esqueceu no
 *  lançamento). viagemId é o id real do servidor. */
export type PendingFoto = {
  clientId: string;
  viagemId: string;
  fotoBlob: Blob;
  fotoMime: string;
  status: SyncStatus;
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

/** Local criado offline. clientId vira id real no servidor (idempotência). */
export type PendingLocal = {
  clientId: string;
  payload: {
    nome: string;
    lat: number;
    lng: number;
    precisao?: number;
    tipo: "CARGA" | "DESCARGA" | "AMBOS";
    clienteIds?: string[];
  };
  status: SyncStatus;
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
};

export type CacheEntry = {
  key: string;
  v: unknown;
  t: number;
};

class RonanDB extends Dexie {
  pendingViagens!: EntityTable<PendingViagem, "clientId">;
  pendingPedagios!: EntityTable<PendingPedagio, "clientId">;
  pendingAbastecimentos!: EntityTable<PendingAbastecimento, "clientId">;
  pendingLocais!: EntityTable<PendingLocal, "clientId">;
  pendingFotos!: EntityTable<PendingFoto, "clientId">;
  cache!: EntityTable<CacheEntry, "key">;

  constructor() {
    super("ronan-motorista");
    // v1-v2 vieram do PWA antigo (catalogos/viagensCache/pedagiosCache/meCache).
    this.version(1).stores({
      pendingViagens: "clientId, status, createdAt",
      pendingPedagios: "clientId, status, createdAt",
      catalogos: "id",
      viagensCache: "id",
      pedagiosCache: "id",
    });
    this.version(2).stores({
      meCache: "id",
    });
    // v3: novo schema unificado de cache + abastecimentos pendentes.
    this.version(3).stores({
      pendingViagens: "clientId, status, createdAt",
      pendingPedagios: "clientId, status, createdAt",
      pendingAbastecimentos: "clientId, status, createdAt",
      cache: "key",
      // Tabelas antigas continuam declaradas (sem rebuild) — Dexie só dropa
      // se eu omitir, e quero migrar opcionalmente, não perder dados.
      catalogos: null,
      viagensCache: null,
      pedagiosCache: null,
      meCache: null,
    });
    // v4: criação de local de descarga offline (mesma estrutura do outbox).
    this.version(4).stores({
      pendingLocais: "clientId, status, createdAt",
    });
    // v5: foto anexada a viagem já sincronizada.
    this.version(5).stores({
      pendingFotos: "clientId, status, createdAt, viagemId",
    });
  }
}

export const db = new RonanDB();

// ===== Helpers de cache key-value (espelha o database.ts do nativo) =====

const CACHE_PREFIX = "q:";

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const row = await db.cache.get(CACHE_PREFIX + key);
    if (!row) return null;
    return row.v as T;
  } catch {
    return null;
  }
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  try {
    await db.cache.put({ key: CACHE_PREFIX + key, v: value, t: Date.now() });
  } catch {
    /* sem espaço / corrupted — ignora silenciosamente */
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await db.cache.delete(CACHE_PREFIX + key);
  } catch {
    /* */
  }
}

// ===== Outbox helpers (mesma API do nativo, sobre Dexie) =====

export async function listPendingViagens(): Promise<PendingViagem[]> {
  try {
    return await db.pendingViagens.orderBy("createdAt").reverse().toArray();
  } catch {
    return [];
  }
}

export async function listPendingPedagios(): Promise<PendingPedagio[]> {
  try {
    return await db.pendingPedagios.orderBy("createdAt").reverse().toArray();
  } catch {
    return [];
  }
}

export async function listPendingAbastecimentos(): Promise<PendingAbastecimento[]> {
  try {
    return await db.pendingAbastecimentos.orderBy("createdAt").reverse().toArray();
  } catch {
    return [];
  }
}

export async function upsertPendingViagem(item: PendingViagem): Promise<void> {
  await db.pendingViagens.put(item);
}

export async function upsertPendingPedagio(item: PendingPedagio): Promise<void> {
  await db.pendingPedagios.put(item);
}

export async function upsertPendingAbastecimento(item: PendingAbastecimento): Promise<void> {
  await db.pendingAbastecimentos.put(item);
}

export async function deletePendingViagem(clientId: string): Promise<void> {
  await db.pendingViagens.delete(clientId);
}

export async function deletePendingPedagio(clientId: string): Promise<void> {
  await db.pendingPedagios.delete(clientId);
}

export async function deletePendingAbastecimento(clientId: string): Promise<void> {
  await db.pendingAbastecimentos.delete(clientId);
}

export async function listPendingLocais(): Promise<PendingLocal[]> {
  try {
    return await db.pendingLocais.orderBy("createdAt").reverse().toArray();
  } catch {
    return [];
  }
}

export async function upsertPendingLocal(item: PendingLocal): Promise<void> {
  await db.pendingLocais.put(item);
}

export async function deletePendingLocal(clientId: string): Promise<void> {
  await db.pendingLocais.delete(clientId);
}

export async function listPendingFotos(): Promise<PendingFoto[]> {
  try {
    return await db.pendingFotos.orderBy("createdAt").reverse().toArray();
  } catch {
    return [];
  }
}

export async function upsertPendingFoto(item: PendingFoto): Promise<void> {
  await db.pendingFotos.put(item);
}

export async function deletePendingFoto(clientId: string): Promise<void> {
  await db.pendingFotos.delete(clientId);
}
