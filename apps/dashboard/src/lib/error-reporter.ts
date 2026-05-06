/**
 * Reporta erros do dashboard pro backend.
 * Sem dependência externa — só fetch.
 */

import { fetchApi } from "./client-api";

export async function reportarErroDashboard(
  err: unknown,
  contexto?: { url?: string; extra?: unknown },
  token?: string,
): Promise<void> {
  if (!token) return;
  try {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    await fetchApi("/errors/dashboard", {
      method: "POST",
      body: JSON.stringify({
        message: message.slice(0, 500),
        stack: stack?.slice(0, 20_000),
        url: contexto?.url ?? (typeof window !== "undefined" ? window.location.href : undefined),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        extra: contexto?.extra,
      }),
      token,
    });
  } catch {
    /* nunca propagar erro do reporter */
  }
}
