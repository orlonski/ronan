import { useEffect, useState } from "react";
import { listPendingProblemasVeiculo, type PendingProblemaVeiculo } from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Os avisos de problema no caminhão esperando subir.
 *
 * Existe pelo mesmo motivo de `use-pending-documentos`: tipo do outbox que não
 * aparece na tela de Pendentes fica preso sem ninguém ver, e ainda conta em
 * "X com erro".
 */
export function usePendingProblemas(): PendingProblemaVeiculo[] {
  const [itens, setItens] = useState<PendingProblemaVeiculo[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const lista = await listPendingProblemasVeiculo();
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
