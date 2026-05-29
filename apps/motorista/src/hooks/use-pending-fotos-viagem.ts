import { useEffect, useState } from "react";
import { listPendingFotos, type PendingFoto } from "@/db/dexie";
import { onSyncChange } from "@/lib/sync";

/**
 * Fotos no outbox local pra uma viagem específica (PWA). Mostra preview
 * imediato via blob URL enquanto sync não rola. Auto-atualiza via
 * onSyncChange quando drain remove (sucesso) ou marca erro.
 */
export function usePendingFotosViagem(viagemId: string | undefined): PendingFoto[] {
  const [fotos, setFotos] = useState<PendingFoto[]>([]);

  useEffect(() => {
    if (!viagemId) {
      setFotos([]);
      return;
    }
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listPendingFotos();
        if (!alive) return;
        setFotos(list.filter((f) => f.viagemId === viagemId));
      } catch {
        /* db pode nao estar pronto */
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [viagemId]);

  return fotos;
}
