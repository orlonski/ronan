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
