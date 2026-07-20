import { z } from "zod";
import { FonteGps, TipoLocal } from "./enums";

export const CriarLocalInput = z.object({
  nome: z.string().min(2).max(120),
  logradouro: z.string().min(2).max(160),
  numero: z.string().max(20).optional(),
  bairro: z.string().max(120).optional(),
  cidade: z.string().min(2).max(120),
  uf: z.string().length(2),
  cep: z.string().regex(/^\d{5}-?\d{3}$/).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  pontoReferencia: z.string().max(200).optional(),
  tipo: z.nativeEnum(TipoLocal),
  clienteIds: z.array(z.string().uuid()).default([]),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type CriarLocalInput = z.infer<typeof CriarLocalInput>;

export const CriarLocalRapidoInput = z.object({
  nome: z.string().min(2).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // Precisão (accuracy em metros) do GPS no momento que o motorista estava no
  // local e tocou "Estou no local". Auditoria de quão confiável é a coordenada.
  precisao: z.number().nonnegative().max(100000).optional(),
  // Fonte do sinal (PRECISA/BALANCED/CACHE) no momento da captura. Complementa
  // a precisão pra auditar: CACHE = caiu no last-known (pode estar defasado).
  fonte: z.nativeEnum(FonteGps).optional(),
  tipo: z.nativeEnum(TipoLocal),
  clienteIds: z.array(z.string().uuid()).default([]),
});
export type CriarLocalRapidoInput = z.infer<typeof CriarLocalRapidoInput>;

export type LocalProximo = {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
  tipo: TipoLocal;
  lat: number | null;
  lng: number | null;
  nivelConfianca: string;
  clienteIds: string[];
  distanciaMetros: number;
  vezesUsadoMotorista: number;
};

// Palavras que ficam minúsculas no meio do nome (não no início).
const PALAVRAS_MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o"]);

/**
 * Padroniza a EXIBIÇÃO do nome de um local (o dado no banco fica intacto): cada
 * palavra com inicial maiúscula, MAS preserva siglas/códigos e números como estão.
 * "pedreira genaro" → "Pedreira Genaro"; "PEDREIRA GENARO" → "Pedreira Genaro";
 * "BR 277 - KM 172" continua "BR 277 - KM 172". Usado nas listas de local dos apps.
 */
export function formatarNomeLocal(nome: string): string {
  if (!nome) return nome;
  return nome
    .trim()
    .split(/\s+/)
    .map((palavra, i) => {
      const minuscula = palavra.toLowerCase();
      // Tem número (277, PR-151, KM172) → código, não mexe.
      if (/\d/.test(palavra)) return palavra;
      // "de/da/do…" no meio fica minúsculo.
      if (i > 0 && PALAVRAS_MINUSCULAS.has(minuscula)) return minuscula;
      // Sigla curta em CAIXA ALTA (BR, KM, PR, S) → mantém.
      if (palavra.length <= 3 && palavra === palavra.toUpperCase() && /[A-ZÀ-Ú]/.test(palavra)) {
        return palavra;
      }
      // Só símbolo (traço, +) → mantém.
      if (!/[a-zà-ú]/i.test(palavra)) return palavra;
      return palavra.charAt(0).toUpperCase() + minuscula.slice(1);
    })
    .join(" ");
}

/**
 * Extrai um "marco" (estaca N ou KM N) do nome de um local. Serve pra
 * distinguir pontos de rodovia/obra geograficamente próximos mas DIFERENTES de
 * propósito (ex.: "PR 151 - Estaca 1742" vs "…Estaca 1743" a ~50m; "BR 277 KM
 * 168" vs "…169"). Compartilhado entre o app (aviso de duplicata na criação) e
 * o backend (dedup do dashboard).
 */
export function extrairMarco(
  nome: string,
): { tipo: "km" | "estaca"; n: number } | null {
  const s = nome.toLowerCase();
  const est = s.match(/\bestaca\s*0*(\d{2,4})\b/);
  if (est) return { tipo: "estaca", n: Number(est[1]) };
  const km = s.match(/\bkm\s*0*(\d{1,3})\b/);
  if (km) return { tipo: "km", n: Number(km[1]) };
  return null;
}

/**
 * Dois nomes têm marco CONFLITANTE (estaca/km diferentes) → não são o mesmo
 * lugar, mesmo perto. Se algum não tem marco, não conflita (proximidade decide).
 */
export function marcoConflita(nomeA: string, nomeB: string): boolean {
  const a = extrairMarco(nomeA);
  const b = extrairMarco(nomeB);
  if (!a || !b) return false;
  return a.tipo !== b.tipo || a.n !== b.n;
}

/**
 * Normaliza um nome pra COMPARAÇÃO (não exibição): minúsculo, sem acento (deburr
 * manual — o Hermes não tem String.normalize confiável), sem pontuação, espaços
 * colapsados. Base do matching fuzzy offline.
 */
export function normalizarNome(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[áàâãä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôõö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/ç/g, "c")
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function trigramas(s: string): Set<string> {
  const t = `  ${s} `;
  const set = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}

/**
 * Similaridade de nome 0..1 — coeficiente de Dice sobre trigramas dos nomes
 * normalizados (mesma ideia do `similarity()` do pg_trgm, mas offline no
 * cliente). "obra curitiba" ~ "obra curitiba centro" = alto; "pedreira a" vs
 * "mercado b" = baixo. Sem dependência nativa; roda em qualquer aparelho.
 */
export function similaridadeNome(a: string, b: string): number {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = trigramas(na);
  const tb = trigramas(nb);
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  const denom = ta.size + tb.size;
  return denom === 0 ? 0 : (2 * inter) / denom;
}

export type CandidatoDuplicata = {
  id: string;
  nome: string;
  /** Distância (m) do GPS atual até o candidato. null = sem coordenada. */
  distanciaM: number | null;
  /** Quantas vezes o motorista já usou este local (últimos 90d). */
  vezesUsado?: number;
  /** Apareceu na lista que o motorista ACABOU de ver antes de "cadastrar novo". */
  jaVisto?: boolean;
};

export type CandidatoRankeado = CandidatoDuplicata & {
  similaridade: number;
  score: number;
  confianca: "alta" | "media" | "baixa";
};

function confiancaDe(sim: number, distanciaM: number | null, jaVisto: boolean): "alta" | "media" | "baixa" {
  const d = distanciaM ?? Infinity;
  if (d < 60 || sim >= 0.55 || (jaVisto && d < 200)) return "alta";
  if (d < 150 || sim >= 0.4 || jaVisto) return "media";
  return "baixa";
}

/**
 * Ranqueia locais candidatos a serem "o mesmo lugar" que o motorista está prestes
 * a cadastrar de novo — combinando proximidade GPS, parecença de nome, se ele
 * ACABOU de ver o local na lista, e quantas vezes já usou. Descarta pares com
 * marco de rodovia conflitante (`marcoConflita`). Puro/offline/testável.
 *
 * `confianca` guia a firmeza do aviso no app: alta = empurrão forte + atrito
 * extra pra criar mesmo assim; media = confirmação normal; baixa = só informativo.
 */
export function rankearCandidatosDuplicata(input: {
  nomeDigitado: string;
  candidatos: CandidatoDuplicata[];
}): CandidatoRankeado[] {
  const nome = input.nomeDigitado.trim();
  return input.candidatos
    .filter((c) => !marcoConflita(nome, c.nome))
    .map((c) => {
      const sim = similaridadeNome(nome, c.nome);
      const prox = c.distanciaM == null ? 0 : Math.max(0, 1 - c.distanciaM / 500);
      const jaVisto = c.jaVisto ? 1 : 0;
      const uso = Math.min((c.vezesUsado ?? 0) / 5, 1);
      const score = 0.45 * sim + 0.4 * prox + 0.1 * jaVisto + 0.05 * uso;
      return { ...c, similaridade: sim, score, confianca: confiancaDe(sim, c.distanciaM, !!c.jaVisto) };
    })
    .sort((a, b) => b.score - a.score);
}
