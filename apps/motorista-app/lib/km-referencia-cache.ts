/**
 * Cache local da referência de km por par carga→descarga. Guarda o
 * ReferenciaKmPayload inteiro (que já embute a config/réguas) pra a sugestão
 * aparecer offline — o caso real é lançar no meio do nada numa rota que o
 * motorista repete toda semana.
 *
 * NÃO pendura no rota-cache: aquele é por par mas guarda uma variante de rota
 * (com retorno), com TTL de 90d. Aqui é a distribuição do que a frota rodou,
 * que anda com o tempo → TTL mais curto (30d) e namespace próprio.
 *
 * Chave: `${cargaId}|${descargaId}`. Storage: AsyncStorage (JSON simples).
 */

// O `storage` é o AsyncStorage carimbado com a empresa ativa (lib/storage.ts):
// o km de referência é o histórico de UMA frota, e o motorista pode rodar pra mais
// de uma. Chave global aqui faria o dado de uma aparecer — ou ser ENVIADO —
// pela outra.
import { storage as AsyncStorage } from "@/lib/storage";
import type { ReferenciaKmPayload } from "@ronan/shared-types";

// v1: bumpar o prefixo (v2, v3...) descarta o cache quando o shape/régua mudar.
const PREFIX = "ronan.kmref.v1:";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — a mediana anda

type Entry = ReferenciaKmPayload & { salvoEmISO: string };

function chave(cargaId: string, descargaId: string): string {
  return `${PREFIX}${cargaId}|${descargaId}`;
}

export async function getKmReferenciaCache(
  cargaId: string,
  descargaId: string,
): Promise<ReferenciaKmPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(chave(cargaId, descargaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry;
    if (!parsed.salvoEmISO) return null;
    const idade = Date.now() - new Date(parsed.salvoEmISO).getTime();
    if (idade > TTL_MS) {
      void AsyncStorage.removeItem(chave(cargaId, descargaId));
      return null;
    }
    const { salvoEmISO: _s, ...payload } = parsed;
    return payload;
  } catch {
    return null;
  }
}

export async function setKmReferenciaCache(
  cargaId: string,
  descargaId: string,
  payload: ReferenciaKmPayload,
): Promise<void> {
  try {
    const entry: Entry = { ...payload, salvoEmISO: new Date().toISOString() };
    await AsyncStorage.setItem(chave(cargaId, descargaId), JSON.stringify(entry));
  } catch {
    /* sem espaço / erro de storage — silencioso */
  }
}

/** Roda no boot: remove entradas expiradas. Best-effort. */
export async function pruneKmReferenciaExpired(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(keys);
    const expiradas: string[] = [];
    for (const [k, v] of pairs) {
      if (!v) {
        expiradas.push(k);
        continue;
      }
      try {
        const parsed = JSON.parse(v) as Entry;
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
