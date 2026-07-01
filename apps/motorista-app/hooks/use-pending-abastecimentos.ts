import { useEffect, useState } from "react";
import { listPendingAbastecimentos, type PendingAbastecimento } from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Lista os abastecimentos no outbox local. Re-renderiza quando o sync notifica
 * (enqueue, drain, delete).
 */
export function usePendingAbastecimentos() {
  const [items, setItems] = useState<PendingAbastecimento[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listPendingAbastecimentos();
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
