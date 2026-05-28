/**
 * Cache local de rotas calculadas pelo OSRM. Quando motorista está offline,
 * usa esse cache pra mostrar KM de rotas conhecidas (mesmo par carga→descarga
 * já calculado antes). TTL = 90d, igual ao backend.
 *
 * Chave: `${origemId}|${destinoId}`. Storage: AsyncStorage (JSON simples).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "ronan.rota:";
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias

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
    const raw = await AsyncStorage.getItem(chave(origemId, destinoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RotaCacheEntry;
    if (!parsed.salvoEmISO) return null;
    const idade = Date.now() - new Date(parsed.salvoEmISO).getTime();
    if (idade > TTL_MS) {
      // Expirado — limpa preguiçosamente.
      void AsyncStorage.removeItem(chave(origemId, destinoId));
      return null;
    }
    return parsed;
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
    await AsyncStorage.setItem(chave(origemId, destinoId), JSON.stringify(entry));
  } catch {
    /* sem espaço / erro de storage — silencioso */
  }
}

/**
 * Roda no boot pra remover entradas expiradas. Best-effort; se falhar,
 * próxima leitura faz prune individual.
 */
export async function pruneExpired(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const rotaKeys = keys.filter((k) => k.startsWith(PREFIX));
    if (rotaKeys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(rotaKeys);
    const expiradas: string[] = [];
    for (const [k, v] of pairs) {
      if (!v) {
        expiradas.push(k);
        continue;
      }
      try {
        const parsed = JSON.parse(v) as RotaCacheEntry;
        const idade = Date.now() - new Date(parsed.salvoEmISO).getTime();
        if (idade > TTL_MS) expiradas.push(k);
      } catch {
        expiradas.push(k);
      }
    }
    if (expiradas.length > 0) await AsyncStorage.multiRemove(expiradas);
  } catch {
    /* silencioso */
  }
}
