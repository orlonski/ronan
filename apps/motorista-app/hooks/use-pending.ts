import { useEffect, useState } from "react";
import { onSyncChange, pendingCounts } from "@/lib/sync";

export function usePending() {
  const [counts, setCounts] = useState({ viagens: 0, pedagios: 0, comErro: 0 });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const c = await pendingCounts();
        if (alive) setCounts(c);
      } catch {
        /* db pode nao estar pronto ainda */
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return counts;
}
