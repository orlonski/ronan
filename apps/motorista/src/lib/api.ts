import type {
  CadastroEmpresa,
  CadastroMotoristaInput,
  ConfirmarCadastroInput,
  SessaoEmpresa,
  StatusMotorista,
} from "@ronan/shared-types";
import { API_URL } from "./api-url";
import { clearTokens, loadTokens, saveTokens, type Tokens } from "./auth";
import { motoristaAtivoId, salvarTokensDe, tokensDe } from "./sessoes";
import { setAuthState } from "./auth-state";
import { clearCadastroStatus, setCadastroStatus } from "./cadastro-status";
import { humanizeZodIssues, type ZodIssueLite } from "./validation";

/**
 * Resposta de login/cadastro. Os campos de topo apontam pro cadastro principal
 * (formato antigo, que a versão anterior do PWA lê). `cadastros` traz UMA SESSÃO
 * POR EMPRESA pra quem roda pra mais de uma — é o que deixa trocar de empresa
 * depois sem digitar senha, inclusive sem sinal.
 */
export type AuthResposta = Tokens & {
  status: StatusMotorista;
  cadastros?: SessaoEmpresa[];
  /** Cadastro novo herdou a senha que ele já usava em outra empresa. */
  senhaHerdada?: boolean;
};

/**
 * A resposta chegou DEPOIS que o motorista trocou de empresa.
 *
 * Toda request nasce amarrada ao cadastro ativo naquele instante (o token é
 * dele). Se a troca acontece enquanto ela está em voo, o dado que volta é da
 * empresa ANTERIOR, mas tudo que grava depois (Dexie, React Query, outbox) já
 * está no namespace da empresa NOVA. Era assim que a lista de uma empresa
 * aparecia (ou sumia) na outra.
 *
 * Descartar é a única resposta certa: dado de empresa errada não se mostra e não
 * se grava. Conta como falha transitória — ninguém desloga e o item tenta de
 * novo já na empresa certa.
 */
export class SessaoTrocadaError extends Error {
  constructor() {
    super("Você trocou de empresa; recarregando os dados da empresa certa.");
  }
}

/** Estoura se a empresa ativa não for mais a que originou a request. */
function conferirDono(dono: string | null): void {
  if (!dono) return; // sessão legada (chave única): não há outra empresa aqui
  if (motoristaAtivoId() !== dono) throw new SessaoTrocadaError();
}

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

/**
 * Uma renovação em voo POR CADASTRO, nunca uma só pro app.
 *
 * Com um singleton global, uma request da empresa B que caísse em 401 durante o
 * refresh da empresa A reaproveitava a promise da A e saía com o token DELA —
 * dado da empresa errada, do jeito mais silencioso possível.
 */
const refreshing = new Map<string, Promise<RefreshResult>>();

async function refresh(dono: string | null): Promise<RefreshResult> {
  const chave = dono ?? "@legado";
  const emVoo = refreshing.get(chave);
  if (emVoo) return emVoo;
  // Os tokens vêm do cadastro que originou a request, não do que estiver ativo
  // agora: quem renova é o dono do token que expirou.
  const tokens = dono ? tokensDe(dono) : loadTokens();
  if (!tokens?.refreshToken) return { status: "invalido" };
  const promessa: Promise<RefreshResult> = (async () => {
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
        // Grava no slot DESTE cadastro. `saveTokens` escreveria no da empresa
        // ativa agora — que pode já ser outra, e aí a empresa nova passaria a
        // rodar com o token da antiga.
        if (dono) salvarTokensDe(dono, fresh);
        else saveTokens(fresh);
        // Reflete aprovação sem precisar relogar (modo "em análise" some
        // sozinho). Só do cadastro que está na tela: o status é um só na UI.
        if (fresh.status && (!dono || motoristaAtivoId() === dono)) setCadastroStatus(fresh.status);
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
      refreshing.delete(chave);
    }
  })();
  refreshing.set(chave, promessa);
  return promessa;
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
  init: {
    body?: unknown;
    isFormData?: boolean;
    auth?: boolean;
    /** Teto próprio, pra chamada que sabidamente demora mais que um GET. */
    timeoutMs?: number;
  } = { auth: true },
): Promise<T> {
  const { body, isFormData = false, auth = true, timeoutMs: tetoProprio } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined && !isFormData) headers["content-type"] = "application/json";
  // De QUEM é esta request. A empresa ativa pode mudar no meio (o motorista roda
  // pra mais de uma), e a resposta que voltar só vale pra quem a disparou.
  const dono = auth ? motoristaAtivoId() : null;
  const tokens = auth ? (dono ? tokensDe(dono) : loadTokens()) : null;
  if (tokens) headers["authorization"] = `Bearer ${tokens.accessToken}`;

  const url = `${API_URL}${path}`;
  const timeoutMs = tetoProprio ?? (isFormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
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
    // Trocou de empresa com a request em voo: o 401 é do token ANTIGO. Não
    // renova nem desloga — a sessão nova não tem nada a ver com isso.
    conferirDono(dono);
    const renov = await refresh(dono);
    if (renov.status === "ok") {
      headers["authorization"] = `Bearer ${renov.tokens.accessToken}`;
      try {
        res = await fetchComTimeout(url, { ...fetchInit, headers }, timeoutMs);
      } catch (err) {
        const isTimeout = (err as Error).name === "AbortError";
        if (isTimeout) throw new TypeError("Tempo esgotado. Verifique sua conexão.");
        throw err;
      }
    } else if (renov.status === "invalido") {
      // Sessão acabou de verdade — desloga. Só depois de conferir que a empresa
      // ativa ainda é esta: derrubar o app por causa do token de uma empresa que
      // ele acabou de deixar seria deslogar quem está logado.
      conferirDono(dono);
      clearTokens();
      clearCadastroStatus();
      setAuthState(false);
      // Redirect via hash change escapa do React Router; melhor deixar
      // o AuthGate observar setAuthState e re-renderizar.
      throw new ApiError(401, null);
    } else {
      // Transitório (rede/servidor): mantém a sessão, só falha esta request.
      throw new TypeError("Sem conexão com o servidor. Tente de novo em instantes.");
    }
  }

  // A resposta é do cadastro que originou a request. Se a empresa ativa mudou
  // enquanto ela vinha, este dado é da empresa anterior — e quem grava depois
  // (Dexie, React Query, outbox) já está no namespace da nova. Descarta.
  conferirDono(dono);

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
  post: <T>(path: string, body: unknown, opts?: { timeoutMs?: number }) =>
    request<T>("POST", path, { body, timeoutMs: opts?.timeoutMs }),
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
  // ---- Empresas do motorista ----
  /** Empresas em que este CPF tem cadastro (mantém o seletor em dia). */
  listarCadastros: () => request<CadastroEmpresa[]>("GET", "/m/auth/cadastros"),
  /** Sessão de outro cadastro do mesmo CPF, sem pedir senha. */
  trocarEmpresa: (motoristaId: string) =>
    request<SessaoEmpresa>("POST", "/m/auth/trocar-empresa", { body: { motoristaId } }),
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
