import { router } from "expo-router";
import { API_URL } from "./api-url";
import { clearTokens, loadTokens, saveTokens, type Tokens } from "./auth";
import { setAuthState } from "./auth-state";
import { humanizeZodIssues, type ZodIssueLite } from "./validation";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : `API ${status}`,
    );
  }
}

/**
 * Converte um erro de API em mensagem PT-BR amigável pro motorista.
 * - Se for ApiError 400 com body.issues (Zod), retorna lista de campos com problema
 * - Senao, retorna a mensagem direta ou um genérico
 */
export function humanizeApiError(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return (err as Error)?.message ?? "Erro inesperado.";
  }
  if (err.status === 400 && err.body && typeof err.body === "object") {
    const body = err.body as { issues?: ZodIssueLite[] };
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      return humanizeZodIssues(body.issues);
    }
  }
  if (err.status === 401) return "Sessão expirou. Entre de novo.";
  if (err.status === 409) return err.message; // ConflictException ja vem em PT-BR (ex: ticket duplicado)
  if (err.status >= 500) return "Servidor com problema. Tente de novo em alguns minutos.";
  return err.message;
}

let refreshing: Promise<Tokens | null> | null = null;

async function refresh(): Promise<Tokens | null> {
  if (refreshing) return refreshing;
  const tokens = await loadTokens();
  if (!tokens?.refreshToken) return null;
  refreshing = (async () => {
    try {
      const res = await fetch(`${API_URL}/m/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) return null;
      const fresh = (await res.json()) as Tokens;
      await saveTokens(fresh);
      return fresh;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Timeout default pra rede 3G/4G ruim. Sem isso, fetch fica pendurado
// pra sempre se servidor n\xc3\xa3o responder. 20s cobre payloads grandes
// (catalogos, foto upload) sem ser frustante.
const REQUEST_TIMEOUT_MS = 20_000;
// Uploads de foto podem demorar mais — 60s.
const UPLOAD_TIMEOUT_MS = 60_000;

async function fetchComTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Critério: relata erros que indicam BUG (não comportamento esperado).
 * Skipa 4xx esperados (validação, auth, conflito) e o endpoint do
 * próprio reporter (evita loop).
 */
function deveReportarErro(status: number | null, path: string): boolean {
  if (path.startsWith("/errors/")) return false; // não reportar erro do próprio reporter
  if (status === null) return true; // network error / timeout / parse fail
  if (status >= 500) return true; // bug servidor
  return false; // 4xx esperado
}

async function reportarSilencioso(
  err: unknown,
  ctx: { method: string; path: string; status?: number | null },
): Promise<void> {
  try {
    const { reportarErro } = await import("./error-reporter");
    void reportarErro(err, {
      url: `${ctx.method} ${ctx.path}`,
      extra: { status: ctx.status ?? null },
    });
  } catch {
    /* nunca propaga erro do reporter */
  }
}

export async function request<T>(
  method: string,
  path: string,
  init: { body?: unknown; isFormData?: boolean; auth?: boolean } = { auth: true },
): Promise<T> {
  const { body, isFormData = false, auth = true } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined && !isFormData) headers["content-type"] = "application/json";
  // Aceita gzip — backend agora tem compression() middleware
  headers["accept-encoding"] = "gzip, deflate";
  let tokens = auth ? await loadTokens() : null;
  if (tokens) headers["authorization"] = `Bearer ${tokens.accessToken}`;

  const url = `${API_URL}${path}`;
  const timeoutMs = isFormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const fetchInit: RequestInit = {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  };

  let res: Response;
  try {
    res = await fetchComTimeout(url, fetchInit, timeoutMs);
  } catch (err) {
    const isTimeout = (err as Error).name === "AbortError";
    const wrapped = isTimeout
      ? new TypeError("Tempo esgotado. Verifique sua conexão.")
      : (err as Error);
    if (deveReportarErro(null, path)) {
      void reportarSilencioso(wrapped, { method, path, status: null });
    }
    throw wrapped;
  }

  if (res.status === 401 && auth) {
    const fresh = await refresh();
    if (fresh) {
      headers["authorization"] = `Bearer ${fresh.accessToken}`;
      try {
        res = await fetchComTimeout(url, { ...fetchInit, headers }, timeoutMs);
      } catch (err) {
        const isTimeout = (err as Error).name === "AbortError";
        const wrapped = isTimeout
          ? new TypeError("Tempo esgotado. Verifique sua conexão.")
          : (err as Error);
        if (deveReportarErro(null, path)) {
          void reportarSilencioso(wrapped, { method, path, status: null });
        }
        throw wrapped;
      }
    } else {
      await clearTokens();
      setAuthState(false);
      router.replace("/login");
      throw new ApiError(401, null);
    }
  }

  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const apiErr = new ApiError(res.status, parsed);
    if (deveReportarErro(res.status, path)) {
      void reportarSilencioso(apiErr, { method, path, status: res.status });
    }
    throw apiErr;
  }
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch (err) {
    if (deveReportarErro(null, path)) {
      void reportarSilencioso(err, { method, path, status: res.status });
    }
    throw err;
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  postForm: <T>(path: string, body: FormData) =>
    request<T>("POST", path, { body, isFormData: true }),
  loginMotorista: (cpf: string, senha: string) =>
    request<Tokens>("POST", "/m/auth/login", {
      body: { cpf, senha },
      auth: false,
    }),
};
