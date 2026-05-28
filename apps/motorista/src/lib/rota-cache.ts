/**
 * Cache local de rotas calculadas pelo OSRM (PWA). Espelha o do app
 * nativo. Storage no Dexie cache table com prefixo "ronan.rota:".
 * TTL = 90d.
 */

import { db } from "@/db/dexie";

const PREFIX = "ronan.rota:";
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type RotaCacheEntry = {
  km: string;
  duracaoSegundos?: number;
  geometria?: string | null;
  salvoEmISO: string;
};

function chave(origemId: string, destinoId: string): string {
  return `${PREFIX}${origemId}|${destinoId}`;
}

export async function getRotaCache(
  origemId: string,
  destinoId: string,
): Promise<RotaCacheEntry | null> {
  try {
    const row = await db.cache.get(chave(origemId, destinoId));
    if (!row) return null;
    const entry = row.v as RotaCacheEntry;
    if (!entry.salvoEmISO) return null;
    const idade = Date.now() - new Date(entry.salvoEmISO).getTime();
    if (idade > TTL_MS) {
      void db.cache.delete(chave(origemId, destinoId));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function setRotaCache(
  origemId: string,
  destinoId: string,
  dados: Omit<RotaCacheEntry, "salvoEmISO">,
): Promise<void> {
  try {
    const entry: RotaCacheEntry = {
      ...dados,
      salvoEmISO: new Date().toISOString(),
    };
    await db.cache.put({
      key: chave(origemId, destinoId),
      v: entry,
      t: Date.now(),
    });
  } catch {
    /* */
  }
}

export async function pruneExpired(): Promise<void> {
  try {
    const rows = await db.cache
      .filter((r) => r.key.startsWith(PREFIX))
      .toArray();
    const expiradas: string[] = [];
    for (const row of rows) {
      const entry = row.v as RotaCacheEntry | null;
      if (!entry?.salvoEmISO) {
        expiradas.push(row.key);
        continue;
      }
      const idade = Date.now() - new Date(entry.salvoEmISO).getTime();
      if (idade > TTL_MS) expiradas.push(row.key);
    }
    if (expiradas.length > 0) await db.cache.bulkDelete(expiradas);
  } catch {
    /* */
  }
}
