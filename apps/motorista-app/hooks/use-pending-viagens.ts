import { useEffect, useState } from "react";
import { listPendingViagens, type PendingViagem } from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Lista as viagens no outbox local. Re-renderiza quando o sync notifica
 * (enqueue, drain, delete).
 */
export function usePendingViagens() {
  const [items, setItems] = useState<PendingViagem[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listPendingViagens();
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
