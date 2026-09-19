import { useEffect, useState } from "react";
import { listPendingPresencaObra, type PendingPresencaObra } from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Os toques de presença na obra que ainda não subiram.
 *
 * Existe pelo mesmo motivo dos irmãos, e o motivo é uma lição já paga: tipo
 * que não aparece na tela de Pendentes some de vista mas continua contando em
 * "X com erro" — o motorista vê o número e não acha o item.
 */
export function usePendingPresencaObra(): PendingPresencaObra[] {
  const [items, setItems] = useState<PendingPresencaObra[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listPendingPresencaObra();
        if (alive) setItems(list);
      } catch {
        /* db indisponivel */
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return items;
}
