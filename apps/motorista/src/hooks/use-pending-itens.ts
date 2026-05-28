import { useEffect, useState } from "react";
import {
  listPendingAbastecimentos,
  listPendingPedagios,
  listPendingViagens,
  type PendingAbastecimento,
  type PendingPedagio,
  type PendingViagem,
} from "@/db/dexie";
import { onSyncChange } from "@/lib/sync";

/**
 * Hook genérico — escuta o sync e devolve as três listas de pendentes.
 * Atualiza ao notify() do sync e a cada N segundos pra refletir status mudando.
 */
export function usePendingItens(): {
  viagens: PendingViagem[];
  pedagios: PendingPedagio[];
  abastecimentos: PendingAbastecimento[];
  loading: boolean;
} {
  const [state, setState] = useState({
    viagens: [] as PendingViagem[],
    pedagios: [] as PendingPedagio[],
    abastecimentos: [] as PendingAbastecimento[],
    loading: true,
  });

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [v, p, a] = await Promise.all([
          listPendingViagens(),
          listPendingPedagios(),
          listPendingAbastecimentos(),
        ]);
        if (alive)
          setState({ viagens: v, pedagios: p, abastecimentos: a, loading: false });
      } catch {
        if (alive) setState((s) => ({ ...s, loading: false }));
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state;
}
