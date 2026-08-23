import Dexie, { type EntityTable } from "dexie";
import { motoristaAtivoId } from "@/lib/sessoes";

export type SyncStatus = "pending" | "syncing" | "error";

export type ZodIssueSaved = {
  path: string;
  code: string;
  message: string;
};

/**
 * De qual cadastro é este item. O motorista pode rodar pra mais de uma empresa
 * no mesmo aparelho, e o pendente de uma NUNCA pode subir com o token da outra —
 * é isso que este campo impede. `undefined` só existe em linha gravada antes das
 * sessões por empresa (ver a migração v6).
 */
type ComDono = { dono?: string };

export type PendingViagem = ComDono & {
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

export type PendingPedagio = ComDono & {
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

export type PendingAbastecimento = ComDono & {
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
export type PendingFoto = ComDono & {
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
export type PendingLocal = ComDono & {
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

/** Prefixo das chaves de cache (antes do carimbo do cadastro). */
const CACHE_PREFIX = "q:";

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
    // v6: cada pendente passa a ter dono (o cadastro do motorista naquela
    // empresa), porque o mesmo CPF pode rodar pra mais de uma e um lançamento
    // JAMAIS pode subir com o token da outra.
    //
    // A migração CARIMBA o que já está aqui com o dono do token que estava
    // guardado — não apaga nada. Perder viagem pendente numa atualização é
    // inaceitável; se não der pra saber o dono (deslogado), a linha fica sem e
    // o login decide (adota se for dele, descarta se não for).
    this.version(6)
      .stores({
        pendingViagens: "clientId, status, createdAt, dono",
        pendingPedagios: "clientId, status, createdAt, dono",
        pendingAbastecimentos: "clientId, status, createdAt, dono",
        pendingLocais: "clientId, status, createdAt, dono",
        pendingFotos: "clientId, status, createdAt, viagemId, dono",
      })
      .upgrade(async (tx) => {
        const dono = donoDoTokenGuardado();
        if (!dono) return;
        for (const tabela of [
          "pendingViagens",
          "pendingPedagios",
          "pendingAbastecimentos",
          "pendingLocais",
          "pendingFotos",
        ]) {
          await tx
            .table(tabela)
            .toCollection()
            .modify((linha: ComDono) => {
              if (!linha.dono) linha.dono = dono;
            });
        }
        // O cache seguia a mesma lógica: chave global vira chave do dono.
        await tx
          .table("cache")
          .toCollection()
          .modify((linha: CacheEntry) => {
            if (linha.key.startsWith(CACHE_PREFIX) && !linha.key.startsWith(`${CACHE_PREFIX}${dono}:`)) {
              linha.key = `${CACHE_PREFIX}${dono}:${linha.key.slice(CACHE_PREFIX.length)}`;
            }
          });
      });
  }
}

/**
 * Quem é o dono do que está guardado — lido do token, sem depender do módulo de
 * sessões (a migração do Dexie roda cedo demais pra confiar em import circular).
 */
function donoDoTokenGuardado(): string | null {
  const raw =
    localStorage.getItem("ronan.motorista.tokens") ?? localStorage.getItem("ronan.dono-legado");
  if (!raw) return null;
  // `ronan.dono-legado` já é o id cru; o outro é o JSON com os tokens.
  if (!raw.startsWith("{")) return raw;
  try {
    const jwt = (JSON.parse(raw) as { accessToken?: string }).accessToken;
    const payload = jwt?.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

export const db = new RonanDB();

// ===== Helpers de cache key-value (espelha o database.ts do nativo) =====

/**
 * Chave de cache SEMPRE carimbada com o cadastro ativo: `q:<motoristaId>:algo`.
 * Sem isso, trocar de empresa mostraria o catálogo e as viagens da anterior.
 * Sem sessão (ainda não migrado), fica na chave global antiga.
 */
function chaveCache(key: string): string {
  const id = motoristaAtivoId();
  return id ? `${CACHE_PREFIX}${id}:${key}` : CACHE_PREFIX + key;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const row = await db.cache.get(chaveCache(key));
    if (!row) return null;
    return row.v as T;
  } catch {
    return null;
  }
}

export async function cachePut<T>(key: string, value: T): Promise<void> {
  try {
    await db.cache.put({ key: chaveCache(key), v: value, t: Date.now() });
  } catch {
    /* sem espaço / corrupted — ignora silenciosamente */
  }
}

/**
 * Joga fora TODO o cache de consultas do cadastro ativo — e só ele.
 *
 * É a reação a descobrir dado de outra empresa aqui dentro (ver a conferência do
 * `/m/me` em `lib/queries.ts`): se um valor veio do namespace errado, os vizinhos
 * podem ter vindo junto, e não dá pra escolher no que confiar. Tudo volta da
 * rede, na empresa certa. NÃO toca no outbox: lançamento do motorista não se
 * apaga por desconfiança de cache.
 */
export async function limparCacheDeConsultas(): Promise<void> {
  try {
    const id = motoristaAtivoId();
    const prefixo = id ? `${CACHE_PREFIX}${id}:` : CACHE_PREFIX;
    const chaves = (await db.cache.toCollection().primaryKeys()) as string[];
    const alvos = chaves.filter((k) => k.startsWith(prefixo));
    if (alvos.length > 0) await db.cache.bulkDelete(alvos);
  } catch {
    /* sem storage: o cache velho segue, mas a rede já corrige na sequência */
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await db.cache.delete(chaveCache(key));
  } catch {
    /* */
  }
}

/** Só o que é do cadastro ativo. Linha sem dono é de antes da migração. */
function meus<T extends ComDono>(itens: T[]): T[] {
  const id = motoristaAtivoId();
  if (!id) return itens;
  return itens.filter((i) => i.dono === id || i.dono === undefined);
}

/** Carimba o item com o cadastro ativo antes de gravar. */
function comDono<T extends ComDono>(item: T): T {
  const id = motoristaAtivoId();
  return id ? { ...item, dono: id } : item;
}

/**
 * Quantos pendentes de OUTRO cadastro estão esperando. O drain roda só na
 * empresa ativa (é a que tem token em uso), então este número é o que impede
 * o pendente da outra de virar silêncio: o seletor mostra na linha dela.
 */
export async function pendentesDoCadastro(motoristaId: string): Promise<number> {
  try {
    const contas = await Promise.all([
      db.pendingViagens.where("dono").equals(motoristaId).count(),
      db.pendingPedagios.where("dono").equals(motoristaId).count(),
      db.pendingAbastecimentos.where("dono").equals(motoristaId).count(),
      db.pendingLocais.where("dono").equals(motoristaId).count(),
      db.pendingFotos.where("dono").equals(motoristaId).count(),
    ]);
    return contas.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

/**
 * Pendentes gravados antes das sessões por empresa e que ficaram sem dono.
 * Adota se forem deste motorista; senão apaga — deixá-los ali faria o próximo
 * login subir lançamento de um sob o token do outro.
 */
export async function resolverPendentesSemDono(
  motoristaId: string | null,
): Promise<void> {
  const tabelas = [
    db.pendingViagens,
    db.pendingPedagios,
    db.pendingAbastecimentos,
    db.pendingLocais,
    db.pendingFotos,
  ];
  for (const t of tabelas) {
    try {
      const orfaos = await t.filter((i: ComDono) => !i.dono).toArray();
      for (const item of orfaos) {
        if (motoristaId) await t.put({ ...item, dono: motoristaId } as never);
        else await t.delete((item as { clientId: string }).clientId);
      }
    } catch {
      /* tabela indisponível: tenta de novo na próxima abertura */
    }
  }
}

// ===== Outbox helpers (mesma API do nativo, sobre Dexie) =====

export async function listPendingViagens(): Promise<PendingViagem[]> {
  try {
    return meus(await db.pendingViagens.orderBy("createdAt").reverse().toArray());
  } catch {
    return [];
  }
}

export async function listPendingPedagios(): Promise<PendingPedagio[]> {
  try {
    return meus(await db.pendingPedagios.orderBy("createdAt").reverse().toArray());
  } catch {
    return [];
  }
}

export async function listPendingAbastecimentos(): Promise<PendingAbastecimento[]> {
  try {
    return meus(await db.pendingAbastecimentos.orderBy("createdAt").reverse().toArray());
  } catch {
    return [];
  }
}

export async function upsertPendingViagem(item: PendingViagem): Promise<void> {
  await db.pendingViagens.put(comDono(item));
}

export async function upsertPendingPedagio(item: PendingPedagio): Promise<void> {
  await db.pendingPedagios.put(comDono(item));
}

export async function upsertPendingAbastecimento(item: PendingAbastecimento): Promise<void> {
  await db.pendingAbastecimentos.put(comDono(item));
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
    return meus(await db.pendingLocais.orderBy("createdAt").reverse().toArray());
  } catch {
    return [];
  }
}

export async function upsertPendingLocal(item: PendingLocal): Promise<void> {
  await db.pendingLocais.put(comDono(item));
}

export async function deletePendingLocal(clientId: string): Promise<void> {
  await db.pendingLocais.delete(clientId);
}

export async function listPendingFotos(): Promise<PendingFoto[]> {
  try {
    return meus(await db.pendingFotos.orderBy("createdAt").reverse().toArray());
  } catch {
    return [];
  }
}

export async function upsertPendingFoto(item: PendingFoto): Promise<void> {
  await db.pendingFotos.put(comDono(item));
}

export async function deletePendingFoto(clientId: string): Promise<void> {
  await db.pendingFotos.delete(clientId);
}
