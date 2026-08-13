/**
 * Telemetria de operação do motorista (PWA). Espelha o event-reporter do
 * app nativo, mas usando Dexie em vez de AsyncStorage. Online via
 * navigator.onLine.
 */

import type { TipoEvento } from "@ronan/shared-types";
import { db } from "@/db/dexie";
import { api } from "./api";
import { motoristaAtivoId } from "./sessoes";

// Fila carimbada com o cadastro ativo: o evento de telemetria é de UMA empresa
// e não pode subir com o token da outra (o motorista pode rodar pra mais de uma).
const queueKey = () => `ronan.eventos-pendentes.${motoristaAtivoId() ?? "sem-sessao"}`;
const MAX_PENDENTES = 200;
const BATCH_SIZE = 50;

type EventoPendente = {
  id: string;
  tipo: string;
  contexto: Record<string, unknown>;
  online: boolean;
  versaoApp?: string;
  capturadoEm: string;
  viagemClientId?: string;
};

let inFlight = false;

export async function reportarEvento(
  tipo: TipoEvento | string,
  contexto: Record<string, unknown>,
  opts?: { viagemClientId?: string },
): Promise<void> {
  try {
    const evento: EventoPendente = {
      id: gerarUuid(),
      tipo,
      contexto,
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      versaoApp: getVersao(),
      capturadoEm: new Date().toISOString(),
      viagemClientId: opts?.viagemClientId,
    };
    await adicionarPendente(evento);
    void drenar();
  } catch {
    /* nunca quebra o app */
  }
}

export async function drenar(): Promise<void> {
  if (inFlight) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  inFlight = true;
  try {
    let pendentes = await getPendentes();
    while (pendentes.length > 0) {
      const batch = pendentes.slice(0, BATCH_SIZE);
      try {
        await api.post("/m/eventos?origem=motorista-pwa", { eventos: batch });
      } catch {
        return;
      }
      pendentes = pendentes.slice(batch.length);
      await setPendentes(pendentes);
    }
  } finally {
    inFlight = false;
  }
}

async function getPendentes(): Promise<EventoPendente[]> {
  try {
    const row = await db.cache.get(queueKey());
    return row ? ((row.v as EventoPendente[]) ?? []) : [];
  } catch {
    return [];
  }
}

async function setPendentes(eventos: EventoPendente[]): Promise<void> {
  try {
    await db.cache.put({ key: queueKey(), v: eventos, t: Date.now() });
  } catch {
    /* */
  }
}

async function adicionarPendente(e: EventoPendente): Promise<void> {
  const cur = await getPendentes();
  cur.push(e);
  await setPendentes(cur.slice(-MAX_PENDENTES));
}

function getVersao(): string {
  // Vite expõe via import.meta.env; fallback "?"
  return (import.meta as unknown as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION ?? "pwa";
}

function gerarUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Instala listeners pra drenar automaticamente quando rede voltar.
 * Chamar uma vez no boot.
 */
export function instalarDrenoAutomatico(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => void drenar());
  // Periodic flush — cobre caso de erro transitório sem precisar de retry manual
  setInterval(() => void drenar(), 60_000);
}
