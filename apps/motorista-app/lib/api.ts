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
import { motoristaAtivoId, salvarTokensDe, tokensDe } from "./sessoes";
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

/**
 * A resposta chegou DEPOIS que o motorista trocou de empresa.
 *
 * Toda request nasce amarrada ao cadastro ativo naquele instante (o token é
 * dele). Se a troca acontece enquanto ela está em voo — o prefetch do boot, a
 * revalidação em background de uma tela, um item do outbox —, o dado que volta é
 * da empresa ANTERIOR, mas tudo que grava depois (cache em disco, React Query,
 * outbox) já está no namespace da empresa NOVA. Era assim que a lista de uma
 * empresa aparecia (ou sumia) na outra.
 *
 * Descartar é a única resposta certa: dado de empresa errada não se mostra e não
 * se grava. Conta como falha transitória — ninguém desloga, nada vira erro do
 * motorista, e a query/o outbox tenta de novo já na empresa certa.
 */
export class SessaoTrocadaError extends Error {
  constructor() {
    super("Você trocou de empresa; recarregando os dados da empresa certa.");
  }
}

/**
 * A empresa ativa está sem token guardado aqui.
 *
 * Acontece quando o slot foi descartado por não ser desta empresa (ver
 * `tokensDe`) e ainda não deu pra pedir outro. Sair sem `Authorization` viraria
 * 401 → refresh sem token → "sessão acabou" → app deslogado, quando na verdade
 * só falta um token que o servidor entrega de graça pro mesmo CPF. Então isto é
 * falha transitória: espera a rede e o reparo (`repararSessaoAtiva`).
 */
export class SessaoIndisponivelError extends Error {
  constructor() {
    super("Sessão desta empresa indisponível agora.");
  }
}

/** Estoura se a empresa ativa não for mais a que originou a request. */
async function conferirDono(dono: string | null, fixo = false): Promise<void> {
  if (!dono || fixo) return; // sessão legada, ou request de um cadastro escolhido a dedo
  if ((await motoristaAtivoId()) !== dono) throw new SessaoTrocadaError();
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
  const tokens = dono ? await tokensDe(dono) : await loadTokens();
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
        if (dono) await salvarTokensDe(dono, fresh);
        else await saveTokens(fresh);
        // Reflete aprovação sem precisar relogar (modo "em análise" some
        // sozinho). Só do cadastro que está na tela: o status é um só na UI.
        if (fresh.status && (!dono || (await motoristaAtivoId()) === dono)) {
          setCadastroStatus(fresh.status);
        }
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
  init: {
    body?: unknown;
    isFormData?: boolean;
    auth?: boolean;
    outbox?: boolean;
    /** Teto próprio, pra chamada que sabidamente demora mais que um GET. */
    timeoutMs?: number;
    /**
     * Fala em nome de OUTRO cadastro do mesmo CPF, não do ativo. Existe só pra
     * emitir a sessão que falta (`/m/auth/trocar-empresa`) sem ter que ativar o
     * outro cadastro por um instante — a resposta é gravada no slot certo por
     * quem chamou, então trocar de empresa no meio não invalida esta chamada.
     */
    comoCadastro?: string;
  } = {
    auth: true,
  },
): Promise<T> {
  const {
    body,
    isFormData = false,
    auth = true,
    outbox = false,
    timeoutMs: tetoProprio,
    comoCadastro,
  } = init;
  const headers: Record<string, string> = { ...appVersionHeaders() };
  if (body !== undefined && !isFormData) headers["content-type"] = "application/json";
  // Aceita gzip — backend agora tem compression() middleware
  headers["accept-encoding"] = "gzip, deflate";
  // De QUEM é esta request. A empresa ativa pode mudar no meio (o motorista roda
  // pra mais de uma), e a resposta que voltar só vale pra quem a disparou.
  const dono = auth ? (comoCadastro ?? (await motoristaAtivoId())) : null;
  const tokens = auth ? (dono ? await tokensDe(dono) : await loadTokens()) : null;
  if (auth && dono && !tokens?.accessToken) throw new SessaoIndisponivelError();
  if (tokens) headers["authorization"] = `Bearer ${tokens.accessToken}`;

  const url = `${API_URL}${path}`;
  // Envios do outbox (sync em background) ganham teto folgado: 4G ruim de
  // caminhoneiro estourava o timeout curto de 8s do foreground e o lançamento
  // ficava preso. Upload de foto (multipart) já tem os seus 45s.
  const timeoutMs =
    tetoProprio ??
    (isFormData ? UPLOAD_TIMEOUT_MS : outbox ? OUTBOX_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
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
    // Trocou de empresa com a request em voo: o 401 é do token ANTIGO. Não
    // renova nem desloga — a sessão nova não tem nada a ver com isso.
    await conferirDono(dono, !!comoCadastro);
    const renov = await refresh(dono);
    if (renov.status === "ok") {
      headers["authorization"] = `Bearer ${renov.tokens.accessToken}`;
      try {
        res = await fetchComTimeout(url, { ...fetchInit, headers }, timeoutMs);
      } catch (err) {
        // Falha de rede/timeout: não reporta (ver acima), só propaga.
        throw traduzirErroFetch(err);
      }
    } else if (renov.status === "invalido") {
      // Sessão acabou de verdade — desloga. Só depois de conferir que a empresa
      // ativa ainda é esta: derrubar o app por causa do token de uma empresa que
      // ele acabou de deixar seria deslogar quem está logado.
      await conferirDono(dono, !!comoCadastro);
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

  // A resposta é do cadastro que originou a request. Se a empresa ativa mudou
  // enquanto ela vinha, este dado é da empresa anterior — e quem grava depois
  // (cache em disco, React Query, outbox) já está no namespace da nova. Descarta.
  await conferirDono(dono, !!comoCadastro);

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
  post: <T>(path: string, body: unknown, opts?: { outbox?: boolean; timeoutMs?: number }) =>
    request<T>("POST", path, { body, outbox: opts?.outbox, timeoutMs: opts?.timeoutMs }),
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
  /** `comoCadastro`: usar o token de outro cadastro do mesmo CPF (reparo). */
  trocarEmpresa: (motoristaId: string, comoCadastro?: string) =>
    request<SessaoEmpresa>("POST", "/m/auth/trocar-empresa", {
      body: { motoristaId },
      comoCadastro,
    }),
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
