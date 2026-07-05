import { useEffect, useState } from "react";
import {
  listPendingCompletarPeso,
  type PendingCompletarPeso,
} from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Lista os "completar peso" no outbox local (viagens AGUARDANDO_PESO cujo peso
 * foi informado e está aguardando sync). Re-renderiza quando o sync notifica.
 */
export function usePendingCompletarPeso(): PendingCompletarPeso[] {
  const [items, setItems] = useState<PendingCompletarPeso[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listPendingCompletarPeso();
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
