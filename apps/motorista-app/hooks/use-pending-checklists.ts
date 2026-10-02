import { useEffect, useState } from "react";
import { listPendingChecklists, type PendingChecklist } from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Os checklists do caminhão esperando subir.
 *
 * Existe pelo mesmo motivo de `use-pending-documentos`: tipo do outbox que não
 * aparece na tela de Pendentes fica preso sem ninguém ver, e ainda conta em
 * "X com erro".
 */
export function usePendingChecklists(): PendingChecklist[] {
  const [itens, setItens] = useState<PendingChecklist[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const lista = await listPendingChecklists();
        if (alive) setItens(lista);
      } catch {
        /* db indisponível */
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return itens;
}
