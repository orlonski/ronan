import Dexie, { type EntityTable } from "dexie";
import type { Catalogos, Me, Viagem, Pedagio } from "@/lib/queries";

export type SyncStatus = "pending" | "syncing" | "error";

export type PendingViagem = {
  clientId: string;
  payload: Record<string, unknown>;
  fotoBlob?: Blob;
  fotoMime?: string;
  status: SyncStatus;
  errorMsg?: string;
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
};

export type PendingPedagio = {
  clientId: string;
  payload: Record<string, unknown>;
  status: SyncStatus;
  errorMsg?: string;
  attempts: number;
  createdAt: number;
  lastTriedAt?: number;
};

export type CachedMe = {
  id: "current";
  data: Me;
  cachedAt: number;
};

export type CachedCatalogos = {
  id: "current";
  data: Catalogos;
  cachedAt: number;
};

export type CachedViagens = {
  id: "current";
  data: Viagem[];
  cachedAt: number;
};

export type CachedPedagios = {
  id: "current";
  data: Pedagio[];
  cachedAt: number;
};

class RonanDB extends Dexie {
  pendingViagens!: EntityTable<PendingViagem, "clientId">;
  pendingPedagios!: EntityTable<PendingPedagio, "clientId">;
  meCache!: EntityTable<CachedMe, "id">;
  catalogos!: EntityTable<CachedCatalogos, "id">;
  viagensCache!: EntityTable<CachedViagens, "id">;
  pedagiosCache!: EntityTable<CachedPedagios, "id">;

  constructor() {
    super("ronan-motorista");
    this.version(1).stores({
      pendingViagens: "clientId, status, createdAt",
      pendingPedagios: "clientId, status, createdAt",
      catalogos: "id",
      viagensCache: "id",
      pedagiosCache: "id",
    });
    this.version(2).stores({
      meCache: "id",
    });
  }
}

export const db = new RonanDB();
