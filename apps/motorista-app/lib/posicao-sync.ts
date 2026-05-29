/**
 * Drena a fila local de posições periódicas pro backend. Idempotência via
 * unique constraint (motoristaId, capturadoEm) — reenvio de mesma posição
 * é silenciosamente ignorado pelo `skipDuplicates`.
 *
 * Hookado no startAutoSync de sync.ts (espelha drenarEventos).
 */

import { api } from "./api";
import { getConfigLocal, getFila, setFila } from "./posicao-periodica";

const BATCH_SIZE = 50;

let inFlight = false;

export async function drenarPosicoes(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    // Defesa: se motorista desativou, não envia mesmo que a fila tenha
    // posições residuais (backend também rejeita, mas evita request).
    const cfg = await getConfigLocal();
    if (!cfg?.ativada) return;

    let fila = await getFila();
    while (fila.length > 0) {
      const batch = fila.slice(0, BATCH_SIZE);
      try {
        await api.post("/m/posicoes", { posicoes: batch });
      } catch {
        return; // backoff natural: tenta na próxima vez
      }
      fila = fila.slice(batch.length);
      await setFila(fila);
    }
  } finally {
    inFlight = false;
  }
}
