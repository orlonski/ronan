/**
 * Captura erros não tratados no client (window.onerror e unhandledrejection),
 * salva no Dexie e tenta enviar quando o motorista loga / volta online.
 * Espelha o error-reporter.ts do nativo, mas usando Dexie em vez de AsyncStorage.
 */
import { api, ApiError } from "./api";
import { db } from "@/db/dexie";

export type CrashEntry = {
  key: string;
  v: {
    mensagem: string;
    stack?: string;
    url?: string;
    extra?: Record<string, unknown>;
    quandoEm: string;
  };
  t: number;
};

const PREFIX_KEY = "crash:";

async function salvar(entry: CrashEntry["v"]): Promise<void> {
  const key = `${PREFIX_KEY}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.cache.put({ key, v: entry, t: Date.now() });
  } catch {
    /* sem espaço */
  }
}

async function pendentes(): Promise<CrashEntry[]> {
  try {
    const rows = await db.cache
      .filter((row) => row.key.startsWith(PREFIX_KEY))
      .toArray();
    return rows as unknown as CrashEntry[];
  } catch {
    return [];
  }
}

export async function reportarErro(
  err: unknown,
  ctx: { url?: string; extra?: Record<string, unknown> } = {},
): Promise<void> {
  const e = err as Error;
  if (err instanceof ApiError) return; // já reportado pelo api.ts em casos relevantes
  try {
    await salvar({
      mensagem: e?.message ?? String(err),
      stack: e?.stack,
      url: ctx.url,
      extra: ctx.extra,
      quandoEm: new Date().toISOString(),
    });
  } catch {
    /* */
  }
  void enviarPendentes();
}

export async function enviarPendentes(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const lista = await pendentes();
  for (const row of lista) {
    try {
      await api.post("/errors/", row.v);
      await db.cache.delete(row.key);
    } catch {
      return; // se um falhar, para — provavelmente backend / rede com problema
    }
  }
}

let installed = false;

export function instalarHandlersGlobais(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (ev) => {
    void reportarErro(ev.error ?? new Error(ev.message), { url: ev.filename });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    void reportarErro(ev.reason, { url: "unhandledrejection" });
  });
}
