import { useEffect, useState } from "react";
import { db, type PendingPedagio, type PendingViagem } from "@/db/dexie";
import { onSyncChange } from "@/lib/sync";

export function usePendingViagens(): PendingViagem[] {
  const [items, setItems] = useState<PendingViagem[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const all = await db.pendingViagens.orderBy("createdAt").reverse().toArray();
      if (alive) setItems(all);
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => { alive = false; off(); };
  }, []);
  return items;
}

export function usePendingPedagios(): PendingPedagio[] {
  const [items, setItems] = useState<PendingPedagio[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const all = await db.pendingPedagios.orderBy("createdAt").reverse().toArray();
      if (alive) setItems(all);
    };
    void refresh();
    const off = onSyncChange(refresh);
    return () => { alive = false; off(); };
  }, []);
  return items;
}

export function usePendingCount() {
  const v = usePendingViagens();
  const p = usePendingPedagios();
  return v.length + p.length;
}
