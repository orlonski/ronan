import { useEffect, useState } from "react";
import {
  listPendingDocumentosAdmissao,
  type PendingDocumentoAdmissao,
} from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/**
 * Os documentos de admissão esperando pra subir.
 *
 * ⚠️ Existe pelo mesmo motivo de `use-pending-outros`: tipo do outbox que não
 * aparece na tela de Pendentes fica invisível pro motorista E pro escritório,
 * sem jeito de tentar de novo nem de descartar — e continua contando em "X com
 * erro", segurando a fila inteira. Já aconteceu três vezes nesta casa.
 *
 * Aqui o silêncio seria pior que nos outros tipos: ele fotografou a CTPS,
 * a tela disse "guardado", e o item morreu. Ele chega na obra convencido de
 * que mandou.
 */
export function usePendingDocumentos(): PendingDocumentoAdmissao[] {
  const [itens, setItens] = useState<PendingDocumentoAdmissao[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const lista = await listPendingDocumentosAdmissao();
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
