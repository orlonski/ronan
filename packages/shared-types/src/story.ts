import { z } from "zod";

/**
 * Stories dos motoristas (estilo Instagram): foto do trecho que todos veem,
 * expira em 24h. Zod é a fonte da verdade; os tipos de saída abaixo descrevem
 * o que os endpoints devolvem pro app.
 */

// Emojis permitidos na reação rápida. Fixo pra não virar campo livre.
export const STORY_EMOJIS = ["❤️", "🔥", "👍", "😂", "😮", "👏"] as const;
export const StoryEmojiEnum = z.enum(STORY_EMOJIS);
export type StoryEmoji = z.infer<typeof StoryEmojiEnum>;

export const MAX_LEGENDA_STORY = 140;

// Base ZodObject sem refine — o controller estende com fotoKey (a foto sobe
// antes, via /m/uploads/story, e vira storageKey).
export const CriarStoryBaseInput = z.object({
  clientId: z.string().uuid(),
  legenda: z.string().trim().max(MAX_LEGENDA_STORY).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export type CriarStoryInput = z.infer<typeof CriarStoryBaseInput>;

export const ReagirStoryInput = z.object({
  emoji: StoryEmojiEnum,
});
export type ReagirStoryInput = z.infer<typeof ReagirStoryInput>;

// ── Tipos de saída (o que o feed/detalhe devolvem) ───────────────────────────

/** Um story individual, do ponto de vista do motorista logado. */
export interface StoryItem {
  id: string;
  motoristaId: string;
  legenda: string | null;
  criadoEm: string; // ISO
  expiraEm: string; // ISO
  /** true se o motorista logado já viu este story. */
  visto: boolean;
  /** Emoji com que o motorista logado reagiu, se reagiu. */
  minhaReacao: StoryEmoji | null;
  /** Total de visualizações (só preenchido pro autor). */
  totalVistos?: number;
}

/** Grupo de stories de um autor — a "bolinha" do feed. */
export interface StoryFeedGrupo {
  autor: { id: string; nome: string };
  /** true se sou o autor deste grupo. */
  ehMeu: boolean;
  /** true se há ao menos um story ainda não visto (anel colorido). */
  temNaoVisto: boolean;
  /** ISO do story mais recente do grupo (ordenação). */
  ultimoEm: string;
  stories: StoryItem[];
}

export interface StoryFeedResponse {
  grupos: StoryFeedGrupo[];
}

/** Um espectador na tela "visto por N" do autor. */
export interface StoryVisualizador {
  motoristaId: string;
  nome: string;
  vistoEm: string; // ISO
  reacao: StoryEmoji | null;
}
