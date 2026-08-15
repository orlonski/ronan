import { useEffect, useState } from "react";
import {
  listPendingEncerrarDiaria,
  type PendingEncerrarDiaria,
} from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Lista os "encerrar diária" no outbox local (viagens AGUARDANDO_SAIDA cuja
 * hora de saída foi marcada e está aguardando sync). Espelho de
 * usePendingCompletarPeso — e obrigatório: tipo que não aparece na tela de
 * Pendentes some de vista mas continua contando em "X com erro" e fica preso.
 */
export function usePendingEncerrarDiaria(): PendingEncerrarDiaria[] {
  const [items, setItems] = useState<PendingEncerrarDiaria[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listPendingEncerrarDiaria();
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
