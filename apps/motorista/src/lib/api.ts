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
  if (err.status === 409) return err.message;
  if (err.status >= 500) return "Servidor com problema. Tente de novo em alguns minutos.";
  return err.message;
}

let refreshing: Promise<Tokens | null> | null = null;

async function refresh(): Promise<Tokens | null> {
  if (refreshing) return refreshing;
  const tokens = loadTokens();
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
      saveTokens(fresh);
      return fresh;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const REQUEST_TIMEOUT_MS = 20_000;
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

export async function request<T>(
  method: string,
  path: string,
  init: { body?: unknown; isFormData?: boolean; auth?: boolean } = { auth: true },
): Promise<T> {
  const { body, isFormData = false, auth = true } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined && !isFormData) headers["content-type"] = "application/json";
  let tokens = auth ? loadTokens() : null;
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
    if (isTimeout) throw new TypeError("Tempo esgotado. Verifique sua conexão.");
    throw err;
  }

  if (res.status === 401 && auth) {
    const fresh = await refresh();
    if (fresh) {
      headers["authorization"] = `Bearer ${fresh.accessToken}`;
      try {
        res = await fetchComTimeout(url, { ...fetchInit, headers }, timeoutMs);
      } catch (err) {
        const isTimeout = (err as Error).name === "AbortError";
        if (isTimeout) throw new TypeError("Tempo esgotado. Verifique sua conexão.");
        throw err;
      }
    } else {
      clearTokens();
      setAuthState(false);
      // Redirect via hash change escapa do React Router; melhor deixar
      // o AuthGate observar setAuthState e re-renderizar.
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
    throw new ApiError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
  atualizarPushToken: (token: string, provider: "fcm" | "webpush" = "webpush") =>
    request<{ ok: true }>("POST", "/m/push-token", { body: { token, provider } }),
  listarNotificacoes: (opts: { cursor?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.limit) qs.set("limit", String(opts.limit));
    const sep = qs.toString() ? `?${qs.toString()}` : "";
    return request<{
      itens: Array<{
        id: string;
        tipo: string;
        titulo: string;
        corpo: string;
        dados: Record<string, unknown> | null;
        lida: boolean;
        lidaEm: string | null;
        criadoEm: string;
      }>;
      nextCursor: string | null;
      naoLidas: number;
    }>("GET", `/m/notificacoes${sep}`);
  },
  marcarNotificacaoLida: (id: string) =>
    request<{ ok: true }>("PATCH", `/m/notificacoes/${id}/lida`),
  marcarTodasNotificacoesLidas: () =>
    request<{ count: number }>("PATCH", `/m/notificacoes/lidas-todas`),
};
