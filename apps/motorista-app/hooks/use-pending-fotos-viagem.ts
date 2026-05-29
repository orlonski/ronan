import { useEffect, useState } from "react";
import { listPendingFotos, type PendingFoto } from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Fotos no outbox local pra uma viagem específica. Mostra preview imediato
 * enquanto a sincronização não rola. Auto-atualiza via onSyncChange quando
 * o drain remove o item da fila (sync sucesso) ou marca erro.
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
