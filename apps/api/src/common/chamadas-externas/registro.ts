/**
 * Regras puras do registro de chamadas externas: que serviço é, o que guardar
 * e o que esconder. Quem captura é o `interceptor.ts` (fetch global + canal de
 * diagnóstico do `http`), quem grava é o `ChamadasExternasService`.
 *
 * O que NUNCA fica guardado: chave de API, token, senha, cookie, foto, áudio,
 * arquivo. CPF, telefone e e-mail saem mascarados. Conteúdo grande é cortado.
 */

/** Tamanho máximo do pedido/da resposta guardados (depois do mascaramento). */
export const LIMITE_CONTEUDO = 32 * 1024;
/** String maior que isto, com cara de base64, é arquivo embutido (foto pra IA). */
const LIMITE_BASE64 = 1500;
const LIMITE_STRING = 4000;

export type ServicoExterno = {
  nome: string;
  /** Alto volume (rota, arquivos): guarda só o resumo, nunca o conteúdo. */
  soResumo: boolean;
};

const host = (url: string | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/** O nome que a tela mostra pra cada destino. Destino desconhecido aparece pelo endereço. */
export function servicoDoHost(h: string, env: Record<string, string | undefined> = process.env): ServicoExterno {
  const x = h.toLowerCase();
  const internos: [string | null, string][] = [
    [host(env.OSRM_URL), "Rotas (OSRM)"],
    [host(env.VALHALLA_URL), "Navegação (Valhalla)"],
    [host(env.EVOLUTION_API_URL ?? env.EVOLUTION_URL), "WhatsApp (Evolution)"],
    [host(env.MINIO_ENDPOINT ? `http://${env.MINIO_ENDPOINT}` : undefined), "Arquivos (MinIO)"],
  ];
  for (const [h2, nome] of internos) {
    if (h2 && x === h2) return { nome, soResumo: nome !== "WhatsApp (Evolution)" };
  }
  const conhecidos: [RegExp, string, boolean?][] = [
    [/(^|\.)anthropic\.com$/, "IA (Anthropic)"],
    [/generativelanguage\.googleapis\.com$/, "IA (Gemini)"],
    [/(^|\.)openai\.com$/, "IA (OpenAI)"],
    [/(^|\.)minimax/, "IA (MiniMax)"],
    [/dados\.antt\.gov\.br$/, "ANTT"],
    [/servicodados\.ibge\.gov\.br$/, "IBGE"],
    [/nominatim\.openstreetmap\.org$/, "Endereços (Nominatim)"],
    [/overpass-api\.de$/, "OpenStreetMap (Overpass)"],
    [/viacep\.com\.br$/, "CEP (ViaCEP)"],
    [/maps\.googleapis\.com$/, "Google Maps"],
    [/graph\.facebook\.com$/, "Meta (WhatsApp/Instagram)"],
    [/(^|\.)exp\.host$/, "Push (Expo)"],
    [/(^|\.)expo\.dev$/, "Expo"],
    [/api\.clickup\.com$/, "ClickUp"],
    [/(^|\.)sefaz/, "SEFAZ"],
    [/(^|\.)osrm|router\.project-osrm/, "Rotas (OSRM)", true],
  ];
  for (const [re, nome, soResumo] of conhecidos) if (re.test(x)) return { nome, soResumo: !!soResumo };
  return { nome: x, soResumo: false };
}

const CHAVE_SECRETA = /senha|password|passwd|secret|token|apikey|api_key|api-key|authorization|cookie|chave_?pix|private/i;

/** Esconde CPF, telefone e e-mail no meio do texto. */
export function mascararTexto(s: string): string {
  return s
    .replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, "***.***.***-$4")
    .replace(/\b(55)?(\d{2})(9?\d{4})(\d{4})\b/g, (m, _ddi, ddd, _a, fim) => (m.length >= 10 ? `(${ddd}) *****-${fim}` : m))
    .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2");
}

function mascararValor(v: unknown, chave = "", profundidade = 0): unknown {
  if (profundidade > 12) return "[…]";
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (CHAVE_SECRETA.test(chave)) return "***";
  if (typeof v === "string") {
    if (v.length > LIMITE_BASE64 && /^[A-Za-z0-9+/=\s]+$/.test(v.slice(0, 200))) {
      return `[arquivo em base64, ${Math.round((v.length * 3) / 4 / 1024)} KB — não guardado]`;
    }
    const t = mascararTexto(v);
    return t.length > LIMITE_STRING ? `${t.slice(0, LIMITE_STRING)}… [+${t.length - LIMITE_STRING} caracteres]` : t;
  }
  if (Array.isArray(v)) {
    const lista = v.slice(0, 200).map((x) => mascararValor(x, "", profundidade + 1));
    return v.length > 200 ? [...lista, `[+${v.length - 200} itens]`] : lista;
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = mascararValor(x, k, profundidade + 1);
    return out;
  }
  return String(v);
}

/** O que vai pro banco: JSON mascarado e cortado no limite. */
export function conteudoParaGuardar(bruto: unknown): unknown {
  let v: unknown = bruto;
  if (typeof bruto === "string") {
    const t = bruto.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        v = JSON.parse(t);
      } catch {
        v = bruto;
      }
    } else if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(t)) {
      // Formulário (a=1&b=2): vira objeto pra mascarar campo a campo.
      v = Object.fromEntries(new URLSearchParams(t));
    }
  }
  const m = mascararValor(v);
  const s = JSON.stringify(m) ?? "";
  if (s.length <= LIMITE_CONTEUDO) return m;
  return { cortado: true, tamanho: s.length, inicio: s.slice(0, LIMITE_CONTEUDO) };
}

/** URL sem segredo na query (`?key=…` do Google, `?token=…`). */
export function urlSemSegredo(url: string): { host: string; caminho: string } {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (CHAVE_SECRETA.test(k) || k === "key") u.searchParams.set(k, "***");
    const q = u.searchParams.toString();
    return { host: u.host, caminho: mascararTexto(decodeURIComponent(u.pathname)) + (q ? `?${q}` : "") };
  } catch {
    return { host: "?", caminho: url.slice(0, 300) };
  }
}

export type UsoDeIa = { modelo: string | null; tokensEntrada: number | null; tokensSaida: number | null };

/** Tokens e modelo da resposta de IA (Anthropic, OpenAI, Gemini). null = não é IA ou não veio. */
export function usoDeIa(resposta: unknown): UsoDeIa | null {
  if (!resposta || typeof resposta !== "object") return null;
  const r = resposta as Record<string, unknown>;
  const u = r.usage as Record<string, number> | undefined;
  if (u && (u.input_tokens != null || u.output_tokens != null)) {
    return { modelo: (r.model as string) ?? null, tokensEntrada: u.input_tokens ?? null, tokensSaida: u.output_tokens ?? null };
  }
  if (u && (u.prompt_tokens != null || u.completion_tokens != null)) {
    return { modelo: (r.model as string) ?? null, tokensEntrada: u.prompt_tokens ?? null, tokensSaida: u.completion_tokens ?? null };
  }
  const g = r.usageMetadata as Record<string, number> | undefined;
  if (g) {
    return { modelo: (r.modelVersion as string) ?? null, tokensEntrada: g.promptTokenCount ?? null, tokensSaida: g.candidatesTokenCount ?? null };
  }
  return null;
}

/** "POST /admin/viagens/3f2a…/fotos" → "POST /admin/viagens/:id/fotos" — agrupa o gatilho. */
export function rotaSemIds(metodo: string, caminho: string): string {
  const p = caminho
    .split("?")[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d{4,}(?=\/|$)/g, "/:n");
  return `${metodo} ${p}`;
}
