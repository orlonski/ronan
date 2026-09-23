import { z } from "zod";

/**
 * Os modelos de IA de cada empresa (`ConfiguracaoIa`).
 *
 * Quem escolhe é a plataforma, na tela de Assinantes: a chave de API e a conta
 * que paga são nossas, então o modelo (e o custo dele) também é decisão nossa.
 */

/** Modelos do casamento com a planilha do cliente (fechamento). */
export const MODELOS_IA_MATCH = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
] as const;
export type ModeloIaMatch = (typeof MODELOS_IA_MATCH)[number];

/**
 * O conferente de ticket tem lista própria, e mais larga.
 *
 * O `modelo` acima roda no OCR que o motorista espera na estrada; este roda
 * numa fila assíncrona, em modo sombra, onde uma leitura ruim não chega a
 * ninguém. É o lugar certo pra experimentar fornecedor novo — daí o MiniMax
 * aparecer só aqui. Se a leitura se provar, ele sobe pra lista de cima.
 *
 * `null` volta pro default do ambiente (CONFERENCIA_MODELO).
 */
export const MODELOS_IA_CONFERENCIA = [...MODELOS_IA_MATCH, "claude-opus-5", "MiniMax-M3"] as const;
export type ModeloIaConferencia = (typeof MODELOS_IA_CONFERENCIA)[number];

export const AtualizarIaConfigInput = z
  .object({
    confidenceMinimo: z.number().min(0.5).max(0.99).optional(),
    janelaDias: z.number().int().min(1).max(14).optional(),
    modelo: z.enum(MODELOS_IA_MATCH).optional(),
    modeloConferencia: z.enum(MODELOS_IA_CONFERENCIA).nullable().optional(),
  })
  // Corpo vazio passaria batido como "salvei" sem alterar nada.
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Diga o que você quer mudar.");
export type AtualizarIaConfigInput = z.infer<typeof AtualizarIaConfigInput>;
