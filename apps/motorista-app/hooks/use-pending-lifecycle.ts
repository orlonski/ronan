import { useEffect, useState } from "react";
import {
  listPendingEventosViagem,
  listPendingViagemFinalizar,
  listPendingViagemIniciar,
} from "@/db/database";
import { onSyncChange } from "@/lib/sync";

/** Uma viagem guiada agrupada (iniciar + eventos + finalizar) pra tela Pendentes. */
export type LifecycleTrip = {
  clientId: string;
  estagio: "abrindo" | "registrando" | "fechando";
  status: "pending" | "syncing" | "error";
  errorMsg?: string;
  errorStatus?: number;
  attempts: number;
  createdAt: number;
};

export function usePendingLifecycle(): LifecycleTrip[] {
  const [trips, setTrips] = useState<LifecycleTrip[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [ini, ev, fin] = await Promise.all([
          listPendingViagemIniciar(),
          listPendingEventosViagem(),
          listPendingViagemFinalizar(),
        ]);
        // Agrupa por clientId da viagem.
        const map = new Map<string, LifecycleTrip>();
        const upsert = (
          clientId: string,
          estagio: LifecycleTrip["estagio"],
          it: { status: LifecycleTrip["status"]; attempts: number; createdAt: number; errorMsg?: string; errorStatus?: number },
        ) => {
          const cur = map.get(clientId);
          const pior = (s: LifecycleTrip["status"]) => (s === "error" ? 2 : s === "syncing" ? 1 : 0);
          if (!cur) {
            map.set(clientId, {
              clientId,
              estagio,
              status: it.status,
              errorMsg: it.errorMsg,
              errorStatus: it.errorStatus,
              attempts: it.attempts,
              createdAt: it.createdAt,
            });
            return;
          }
          // Estágio mais avançado ganha o rótulo; pior status prevalece.
          const ordem = { abrindo: 0, registrando: 1, fechando: 2 } as const;
          if (ordem[estagio] > ordem[cur.estagio]) cur.estagio = estagio;
          if (pior(it.status) > pior(cur.status)) {
            cur.status = it.status;
            cur.errorMsg = it.errorMsg;
            cur.errorStatus = it.errorStatus;
            cur.attempts = it.attempts;
          }
          cur.createdAt = Math.min(cur.createdAt, it.createdAt);
        };
        for (const i of ini) upsert(i.clientId, "abrindo", i);
        for (const e of ev) upsert(e.viagemClientId, "registrando", e);
        for (const f of fin) upsert(f.clientId, "fechando", f);
        const list = [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
        if (alive) setTrips(list);
      } catch {
        /* db pode nao estar pronto */
      }
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return trips;
}
