import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { router } from "expo-router";
import { Platform } from "react-native";
import type {
  CadastroEmpresa,
  CadastroMotoristaInput,
  ConfirmarCadastroInput,
  RedefinirSenhaInput,
  SessaoEmpresa,
  StatusMotorista,
} from "@ronan/shared-types";
import { API_URL } from "./api-url";
import { clearTokens, loadTokens, saveTokens, type Tokens } from "./auth";
import { setAuthState } from "./auth-state";
import { clearCadastroStatus, setCadastroStatus } from "./cadastro-status";
import { humanizeZodIssues, type ZodIssueLite } from "./validation";
import { marcarInternetFalha, marcarInternetOk } from "./connectivity";

/**
 * Resposta de login/cadastro/reset. Os campos de topo apontam pro cadastro
 * principal (formato antigo, que o app de antes desta versão lê). `cadastros`
 * traz UMA SESSÃO POR EMPRESA pra quem roda pra mais de uma — é o que deixa
 * trocar de empresa depois sem digitar senha, inclusive sem sinal.
 */
export type AuthResposta = Tokens & {
  status: StatusMotorista;
  cadastros?: SessaoEmpresa[];
  /** Cadastro novo herdou a senha que ele já usava em outra empresa. */
  senhaHerdada?: boolean;
};

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
  // Erros com `code` do backend já trazem mensagem PT-BR pronta pro motorista
  // (CPF não cadastrado, celular divergente, placa em uso, envio WhatsApp
  // falhou…). Preferimos ela — inclusive nos 5xx, que teriam texto genérico.
  if (apiErrorCode(err)) return err.message;
  if (err.status === 401) return "Sessão expirou. Entre de novo.";
  if (err.status === 409) return err.message; // ConflictException ja vem em PT-BR (ex: ticket duplicado)
  if (err.status >= 500) return "Servidor com problema. Tente de novo em alguns minutos.";
  return err.message;
}

/**
 * Código de erro estruturado do backend (`body.code`), quando houver — pras
 * telas reagirem (ex: mostrar link pro cadastro / pro "esqueci a senha").
 */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { code?: unknown } | null;
  return body && typeof body.code === "string" ? body.code : null;
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
  // Plataforma: "ios" | "android". O backend depende disso pra decidir força-
  // atualização (aprende a versão mais nova por plataforma). Sem isso a feature
  // fica inerte. Platform.OS é síncrono e sempre existe.
  h["x-app-platform"] = Platform.OS;
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

// Timeout default pra rede 3G/4G ruim. Sem isso, fetch fica pendurado pra
// sempre se o servidor não responder. 8s é curto de propósito: com as telas
// cache-first (lib/queries.ts), quem tem cache nem espera a rede — esse teto
// só vale no primeiro uso e na revalidação em background. Em 4G fraco, 8s é
// tempo de sobra pra um GET responder, e corta a "morte" quando não há cache.
const REQUEST_TIMEOUT_MS = 8_000;
// Uploads de foto (multipart) precisam de mais fôlego — 45s. É background
// (outbox), então não pesa no percebido, mas não deixamos infinito.
const UPLOAD_TIMEOUT_MS = 45_000;
// Envios do outbox (POST JSON de viagem/pedágio/etc no sync): 30s. O 8s do
// foreground é curto demais pra 4G ruim e prendia o lançamento em "pending".
const OUTBOX_TIMEOUT_MS = 30_000;

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

// Sinal de conectividade ruim: instante da última falha de rede/timeout (fetch
// abortado ou sem conexão). O outbox (lib/sync.ts) consulta isso pra fazer
// backoff em 4G ruim — sem ele, cada item da fila penduraria até o timeout, um
// após o outro, roubando banda das telas que o motorista está esperando ver.
let ultimaFalhaRedeAt = 0;

export function getUltimaFalhaRedeAt(): number {
  return ultimaFalhaRedeAt;
}

export function marcarFalhaRede(): void {
  ultimaFalhaRedeAt = Date.now();
}

/** Converte erro do fetch em TypeError legível e registra a falha de rede. */
function traduzirErroFetch(err: unknown): Error {
  marcarFalhaRede();
  marcarInternetFalha(); // o fetch estourou de verdade → offline (a menos que houve sucesso agora)
  const isTimeout = (err as Error).name === "AbortError";
  return isTimeout
    ? new TypeError("Tempo esgotado. Verifique sua conexão.")
    : (err as Error);
}

/**
 * Critério: relata erros que indicam BUG (não comportamento esperado).
 * Skipa 4xx esperados (validação, auth, conflito) e o endpoint do
 * próprio reporter (evita loop).
 */
function deveReportarErro(status: number | null, path: string): boolean {
  if (path.startsWith("/errors/")) return false; // não reportar erro do próprio reporter
  if (status === null) return true; // parse fail de resposta 2xx (rede/timeout não passam mais por aqui)
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
  init: { body?: unknown; isFormData?: boolean; auth?: boolean; outbox?: boolean } = {
    auth: true,
  },
): Promise<T> {
  const { body, isFormData = false, auth = true, outbox = false } = init;
  const headers: Record<string, string> = { ...appVersionHeaders() };
  if (body !== undefined && !isFormData) headers["content-type"] = "application/json";
  // Aceita gzip — backend agora tem compression() middleware
  headers["accept-encoding"] = "gzip, deflate";
  let tokens = auth ? await loadTokens() : null;
  if (tokens) headers["authorization"] = `Bearer ${tokens.accessToken}`;

  const url = `${API_URL}${path}`;
  // Envios do outbox (sync em background) ganham teto folgado: 4G ruim de
  // caminhoneiro estourava o timeout curto de 8s do foreground e o lançamento
  // ficava preso. Upload de foto (multipart) já tem os seus 45s.
  const timeoutMs = isFormData
    ? UPLOAD_TIMEOUT_MS
    : outbox
      ? OUTBOX_TIMEOUT_MS
      : REQUEST_TIMEOUT_MS;
  const fetchInit: RequestInit = {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  };

  let res: Response;
  try {
    res = await fetchComTimeout(url, fetchInit, timeoutMs);
    marcarInternetOk(); // recebeu resposta do servidor (mesmo 4xx/5xx) = tem internet
  } catch (err) {
    // Falha de rede/timeout (status null): ruído de conectividade na estrada,
    // não bug acionável. Não reporta; marca o instante (o outbox usa pra
    // backoff) e propaga pra UI/retry enxergar.
    throw traduzirErroFetch(err);
  }

  if (res.status === 401 && auth) {
    const renov = await refresh();
    if (renov.status === "ok") {
      headers["authorization"] = `Bearer ${renov.tokens.accessToken}`;
      try {
        res = await fetchComTimeout(url, { ...fetchInit, headers }, timeoutMs);
      } catch (err) {
        // Falha de rede/timeout: não reporta (ver acima), só propaga.
        throw traduzirErroFetch(err);
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
      marcarFalhaRede();
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
  post: <T>(path: string, body: unknown, opts?: { outbox?: boolean }) =>
    request<T>("POST", path, { body, outbox: opts?.outbox }),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  postForm: <T>(path: string, body: FormData, opts?: { outbox?: boolean }) =>
    request<T>("POST", path, { body, isFormData: true, outbox: opts?.outbox }),
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
  reenviarCodigoCadastro: (cpf: string, codigoEmpresa: string) =>
    request<{ ok: true; expiraEmSegundos: number }>("POST", "/m/auth/cadastro/reenviar", {
      body: { cpf, codigoEmpresa },
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
  // ---- Esqueci minha senha ----
  esqueciSenha: (cpf: string, telefone: string) =>
    request<{ ok: true; expiraEmSegundos: number }>("POST", "/m/auth/senha/esqueci", {
      body: { cpf, telefone },
      auth: false,
    }),
  reenviarCodigoSenha: (cpf: string) =>
    request<{ ok: true; expiraEmSegundos: number }>("POST", "/m/auth/senha/reenviar", {
      body: { cpf },
      auth: false,
    }),
  redefinirSenha: async (body: RedefinirSenhaInput) => {
    const res = await request<AuthResposta>("POST", "/m/auth/senha/redefinir", {
      body,
      auth: false,
    });
    setCadastroStatus(res.status);
    return res;
  },
  // ---- Empresas do motorista ----
  /** Empresas em que este CPF tem cadastro (mantém o seletor em dia). */
  listarCadastros: () => request<CadastroEmpresa[]>("GET", "/m/auth/cadastros"),
  /** Sessão de outro cadastro do mesmo CPF, sem pedir senha. */
  trocarEmpresa: (motoristaId: string) =>
    request<SessaoEmpresa>("POST", "/m/auth/trocar-empresa", { body: { motoristaId } }),
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
