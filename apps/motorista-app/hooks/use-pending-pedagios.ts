import { useEffect, useState } from "react";
import { listPendingPedagios, type PendingPedagio } from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Lista os pedágios no outbox local. Re-renderiza quando o sync notifica
 * (enqueue, drain, delete).
 */
export function usePendingPedagios() {
  const [items, setItems] = useState<PendingPedagio[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listPendingPedagios();
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
