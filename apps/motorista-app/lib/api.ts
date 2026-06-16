import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { router } from "expo-router";
import type {
  CadastroMotoristaInput,
  ConfirmarCadastroInput,
  StatusMotorista,
} from "@ronan/shared-types";
import { API_URL } from "./api-url";
import { clearTokens, loadTokens, saveTokens, type Tokens } from "./auth";
import { setAuthState } from "./auth-state";
import { clearCadastroStatus, setCadastroStatus } from "./cadastro-status";
import { humanizeZodIssues, type ZodIssueLite } from "./validation";

/** Resposta de login/confirmar-cadastro: tokens + status de aprovação. */
export type AuthResposta = Tokens & { status: StatusMotorista };

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
    // fetch nativo do RN joga TypeError("Network request failed") quando o
    // device está offline ou não consegue completar a chamada.
    if (err instanceof TypeError) return "Sem internet. Verifique sua conexão.";
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

/**
 * Headers que identificam a versão do app rodando, pro backend registrar e o
 * dashboard mostrar quem está atualizado. Memoizado: nada disso muda durante a
 * sessão (só num reload OTA, que reinicia o processo). Em dev/Expo Go vários
 * desses vêm vazios — tudo bem, mandamos só o que existir.
 */
let versionHeadersCache: Record<string, string> | null = null;
function appVersionHeaders(): Record<string, string> {
  if (versionHeadersCache) return versionHeadersCache;
  const h: Record<string, string> = {};
  const versao = Constants.expoConfig?.version;
  if (versao) h["x-app-version"] = versao;
  if (Updates.updateId) h["x-app-update-id"] = Updates.updateId;
  // createdAt é a data de publicação do bundle OTA rodando — o sinal real de
  // "quão velho é o código deste motorista".
  if (Updates.createdAt) h["x-app-built-at"] = Updates.createdAt.toISOString();
  if (Updates.channel) h["x-app-channel"] = Updates.channel;
  versionHeadersCache = h;
  return h;
}

/**
 * Resultado da renovação. CRUCIAL distinguir:
 *  - "invalido": servidor REJEITOU o refresh token (401/403) ou não há token →
 *    a sessão acabou de verdade, pode deslogar.
 *  - "transitorio": rede/timeout/servidor fora (5xx) — NÃO desloga. O refresh
 *    token segue válido (dura 90d); é só uma falha momentânea (sem sinal, túnel,
 *    deploy da API). Mantém a sessão e tenta de novo na próxima request.
 */
type RefreshResult =
  | { status: "ok"; tokens: Tokens }
  | { status: "invalido" }
  | { status: "transitorio" };

let refreshing: Promise<RefreshResult> | null = null;

async function refresh(): Promise<RefreshResult> {
  if (refreshing) return refreshing;
  const tokens = await loadTokens();
  if (!tokens?.refreshToken) return { status: "invalido" };
  refreshing = (async () => {
    try {
      const res = await fetchComTimeout(
        `${API_URL}/m/auth/refresh`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (res.ok) {
        const fresh = (await res.json()) as Tokens & { status?: StatusMotorista };
        await saveTokens(fresh);
        // Reflete aprovação sem precisar relogar (modo "em análise" some sozinho).
        if (fresh.status) setCadastroStatus(fresh.status);
        return { status: "ok", tokens: fresh };
      }
      // Só 401/403 = refresh token realmente inválido/expirado → deslogar.
      // 5xx/429/etc = servidor com problema momentâneo → não desloga.
      return res.status === 401 || res.status === 403
        ? { status: "invalido" }
        : { status: "transitorio" };
    } catch {
      // Erro de rede / timeout (sem sinal, túnel) → não desloga.
      return { status: "transitorio" };
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
    // Falha de fetch sem status: pode ser servidor caído OU motorista offline.
    // Só faz sentido reportar a primeira; offline é limitação física do device.
    if (ctx.status == null) {
      const net = await NetInfo.fetch();
      if (!net.isConnected) return;
    }
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
  const headers: Record<string, string> = { ...appVersionHeaders() };
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
    const renov = await refresh();
    if (renov.status === "ok") {
      headers["authorization"] = `Bearer ${renov.tokens.accessToken}`;
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
    } else if (renov.status === "invalido") {
      // Sessão acabou de verdade — desloga.
      await clearTokens();
      await clearCadastroStatus();
      setAuthState(false);
      router.replace("/login");
      throw new ApiError(401, null);
    } else {
      // Transitório (rede/servidor): mantém a sessão, só falha esta request.
      throw new TypeError("Sem conexão com o servidor. Tente de novo em instantes.");
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
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  postForm: <T>(path: string, body: FormData) =>
    request<T>("POST", path, { body, isFormData: true }),
  loginMotorista: async (cpf: string, senha: string) => {
    const res = await request<AuthResposta>("POST", "/m/auth/login", {
      body: { cpf, senha },
      auth: false,
    });
    setCadastroStatus(res.status);
    return res;
  },
  iniciarCadastro: (body: CadastroMotoristaInput) =>
    request<{ ok: true; expiraEmSegundos: number }>("POST", "/m/auth/cadastro/iniciar", {
      body,
      auth: false,
    }),
  reenviarCodigoCadastro: (cpf: string) =>
    request<{ ok: true; expiraEmSegundos: number }>("POST", "/m/auth/cadastro/reenviar", {
      body: { cpf },
      auth: false,
    }),
  confirmarCadastro: async (body: ConfirmarCadastroInput) => {
    const res = await request<AuthResposta>("POST", "/m/auth/cadastro/confirmar", {
      body,
      auth: false,
    });
    setCadastroStatus(res.status);
    return res;
  },
  atualizarPushToken: (token: string) =>
    request<{ ok: true }>("POST", "/m/push-token", { body: { token } }),
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
