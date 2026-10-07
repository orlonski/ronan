import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";
import { contaAtual } from "../conta/conta-context";
import { conteudoParaGuardar, servicoDoHost, urlSemSegredo, usoDeIa } from "./registro";

/**
 * Captura TODA chamada que a API faz pra fora, sem cada integração precisar
 * lembrar de registrar — inclusive as que alguém criar amanhã:
 *
 *  - `fetch` global (IA, ANTT, IBGE, mapas, WhatsApp…): envelopado na subida,
 *    ANTES de qualquer SDK guardar a referência. Pega pedido e resposta.
 *  - módulo `http`/`https` (MinIO, push do Expo…): pelo canal de diagnóstico do
 *    Node, só o resumo (destino, situação, tempo).
 *
 * Nada aqui pode derrubar a chamada medida: toda falha do registro é engolida.
 * A gravação é em lote, fora do caminho da requisição.
 */

export type RegistroChamada = {
  criadoEm: Date;
  contaId: string | null;
  gatilho: string | null;
  servico: string;
  host: string;
  metodo: string;
  caminho: string;
  status: number | null;
  ok: boolean;
  duracaoMs: number;
  bytesEnvio: number | null;
  bytesResposta: number | null;
  pedido: unknown;
  resposta: unknown;
  erro: string | null;
  iaModelo: string | null;
  iaTokensEntrada: number | null;
  iaTokensSaida: number | null;
};

/** O que disparou a chamada: "POST /admin/…", "cron:sincronizar-pracas". */
const gatilhos = new AsyncLocalStorage<string>();
export function comGatilho<T>(gatilho: string, fn: () => T): T {
  return gatilhos.run(gatilho, fn);
}

const fila: RegistroChamada[] = [];
const LIMITE_FILA = 2000;
let gravador: ((lote: RegistroChamada[]) => Promise<void>) | null = null;
let instalado = false;

/** Quem grava (o service, quando o Nest sobe). Até lá, a fila espera. */
export function definirGravador(fn: (lote: RegistroChamada[]) => Promise<void>) {
  gravador = fn;
}

/** Tira da fila pra gravar. Chamado pelo service a cada poucos segundos. */
export function tirarDaFila(max = 200): RegistroChamada[] {
  return fila.splice(0, max);
}

function enfileirar(r: RegistroChamada) {
  if (fila.length >= LIMITE_FILA) fila.shift(); // pico: perde o mais velho, nunca trava
  fila.push(r);
}

const TEXTUAL = /json|text|xml|csv|javascript|x-www-form-urlencoded|graphql/i;
const LIMITE_LEITURA = 256 * 1024;

async function lerCorpoDaResposta(res: Response): Promise<{ conteudo: unknown; bytes: number | null }> {
  const tipo = res.headers.get("content-type") ?? "";
  const tamanho = Number(res.headers.get("content-length")) || null;
  if (!TEXTUAL.test(tipo)) return { conteudo: tipo ? `[${tipo.split(";")[0]}${tamanho ? `, ${tamanho} bytes` : ""} — não guardado]` : null, bytes: tamanho };
  if (!res.body) return { conteudo: null, bytes: tamanho };
  // Lê no máximo 256 KB e solta: resposta em fluxo (SSE) nunca termina.
  const leitor = res.body.getReader();
  const partes: Uint8Array[] = [];
  let lidos = 0;
  const prazo = Date.now() + 15_000;
  try {
    while (lidos < LIMITE_LEITURA && Date.now() < prazo) {
      const { done, value } = await leitor.read();
      if (done) break;
      partes.push(value);
      lidos += value.byteLength;
    }
  } finally {
    leitor.cancel().catch(() => {});
  }
  const texto = new TextDecoder().decode(Buffer.concat(partes.map((p) => Buffer.from(p))));
  return { conteudo: texto, bytes: tamanho ?? lidos };
}

function corpoDoPedido(body: unknown): { conteudo: unknown; bytes: number | null } {
  if (body == null) return { conteudo: null, bytes: null };
  if (typeof body === "string") return { conteudo: body, bytes: Buffer.byteLength(body) };
  if (body instanceof URLSearchParams) {
    const s = body.toString();
    return { conteudo: s, bytes: s.length };
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const campos: Record<string, string> = {};
    body.forEach((v, k) => {
      campos[k] = typeof v === "string" ? v : `[arquivo ${(v as Blob).size} bytes — não guardado]`;
    });
    return { conteudo: campos, bytes: null };
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    const n = body instanceof ArrayBuffer ? body.byteLength : (body as ArrayBufferView).byteLength;
    return { conteudo: `[binário ${n} bytes — não guardado]`, bytes: n };
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) return { conteudo: `[arquivo ${body.size} bytes — não guardado]`, bytes: body.size };
  return { conteudo: "[fluxo — não guardado]", bytes: null };
}

function contexto() {
  const c = contaAtual();
  return { contaId: c?.contaId ?? null, gatilho: gatilhos.getStore() ?? null };
}

/** Liga a captura. Idempotente; chamar no topo do main, antes do Nest. */
export function instalarRegistroDeChamadas(): void {
  if (instalado) return;
  instalado = true;

  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function fetchRegistrado(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const inicio = performance.now();
    let url = "";
    let metodo = "GET";
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      metodo = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
    } catch {
      /* sem url: registra como "?" */
    }
    const ctx = contexto();
    try {
      const res = await original(input, init);
      void registrarFetch(url, metodo, init?.body, res, inicio, ctx).catch(() => {});
      return res;
    } catch (e) {
      try {
        const { host, caminho } = urlSemSegredo(url);
        const s = servicoDoHost(host);
        const ped = s.soResumo ? null : corpoDoPedido(init?.body);
        enfileirar({
          criadoEm: new Date(),
          ...ctx,
          servico: s.nome,
          host,
          metodo,
          caminho,
          status: null,
          ok: false,
          duracaoMs: Math.round(performance.now() - inicio),
          bytesEnvio: ped?.bytes ?? null,
          bytesResposta: null,
          pedido: ped ? conteudoParaGuardar(ped.conteudo) : null,
          resposta: null,
          erro: (e as Error)?.message?.slice(0, 500) ?? "falhou",
          iaModelo: null,
          iaTokensEntrada: null,
          iaTokensSaida: null,
        });
      } catch {
        /* o registro nunca derruba a chamada */
      }
      throw e;
    }
  } as typeof fetch;

  async function registrarFetch(
    url: string,
    metodo: string,
    body: unknown,
    res: Response,
    inicio: number,
    ctx: { contaId: string | null; gatilho: string | null },
  ) {
    const { host, caminho } = urlSemSegredo(url);
    const s = servicoDoHost(host);
    const duracaoMs = Math.round(performance.now() - inicio);
    let pedido: unknown = null;
    let resposta: unknown = null;
    let bytesEnvio: number | null = null;
    let bytesResposta: number | null = Number(res.headers.get("content-length")) || null;
    let ia: ReturnType<typeof usoDeIa> = null;
    if (!s.soResumo) {
      const p = corpoDoPedido(body);
      pedido = conteudoParaGuardar(p.conteudo);
      bytesEnvio = p.bytes;
      try {
        const r = await lerCorpoDaResposta(res.clone());
        bytesResposta = r.bytes;
        if (typeof r.conteudo === "string") {
          try {
            ia = usoDeIa(JSON.parse(r.conteudo));
          } catch {
            /* não é JSON */
          }
        }
        resposta = conteudoParaGuardar(r.conteudo);
      } catch {
        resposta = "[não deu pra ler a resposta]";
      }
    }
    enfileirar({
      criadoEm: new Date(),
      ...ctx,
      servico: s.nome,
      host,
      metodo,
      caminho,
      status: res.status,
      ok: res.ok,
      duracaoMs,
      bytesEnvio,
      bytesResposta,
      pedido,
      resposta,
      erro: res.ok ? null : `HTTP ${res.status} ${res.statusText}`.trim(),
      iaModelo: ia?.modelo ?? null,
      iaTokensEntrada: ia?.tokensEntrada ?? null,
      iaTokensSaida: ia?.tokensSaida ?? null,
    });
  }

  // http/https (quem não usa fetch): só o resumo.
  const inicios = new WeakMap<object, { inicio: number; ctx: ReturnType<typeof contexto> }>();
  const registrarHttp = (req: { host?: string; method?: string; path?: string; protocol?: string }, status: number | null, erro: string | null) => {
    try {
      const marca = inicios.get(req);
      if (!marca) return;
      inicios.delete(req);
      const host = String(req.host ?? "?");
      const { caminho } = urlSemSegredo(`${req.protocol ?? "http:"}//${host}${req.path ?? "/"}`);
      enfileirar({
        criadoEm: new Date(),
        ...marca.ctx,
        servico: servicoDoHost(host).nome,
        host,
        metodo: String(req.method ?? "GET"),
        caminho,
        status,
        ok: status != null && status < 400 && !erro,
        duracaoMs: Math.round(performance.now() - marca.inicio),
        bytesEnvio: null,
        bytesResposta: null,
        pedido: null,
        resposta: null,
        erro,
        iaModelo: null,
        iaTokensEntrada: null,
        iaTokensSaida: null,
      });
    } catch {
      /* nunca derruba */
    }
  };
  diagnosticsChannel.subscribe("http.client.request.start", (m) => {
    const { request } = m as { request: object };
    inicios.set(request, { inicio: performance.now(), ctx: contexto() });
  });
  diagnosticsChannel.subscribe("http.client.response.finish", (m) => {
    const { request, response } = m as { request: object; response: { statusCode?: number } };
    registrarHttp(request as never, response?.statusCode ?? null, null);
  });
  diagnosticsChannel.subscribe("http.client.request.error", (m) => {
    const { request, error } = m as { request: object; error: Error };
    registrarHttp(request as never, null, error?.message?.slice(0, 500) ?? "falhou");
  });
}

/** Pra quem quer saber se o gravador já está de pé (testes, diagnóstico). */
export function temGravador(): boolean {
  return gravador != null;
}
export async function gravarAgora(): Promise<void> {
  if (!gravador) return;
  const lote = tirarDaFila();
  if (lote.length) await gravador(lote);
}
