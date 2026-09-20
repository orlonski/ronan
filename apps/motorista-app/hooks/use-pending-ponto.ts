import { useEffect, useState } from "react";
import { listPendingPonto, type PendingPonto } from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * As batidas de ponto que ainda não subiram.
 *
 * Mesma lição já paga dos irmãos: tipo que não aparece na tela de Pendentes
 * some de vista e continua contando em "X com erro". Aqui a consequência é
 * pior que em qualquer outro tipo — o que some é prova de jornada.
 */
export function usePendingPonto(): PendingPonto[] {
  const [items, setItems] = useState<PendingPonto[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const list = await listPendingPonto();
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
