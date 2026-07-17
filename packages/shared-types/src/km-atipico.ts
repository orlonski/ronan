import { z } from "zod";

// Referência de km por trajeto + detecção de km atípico.
//
// A regra de decisão (`avaliarKm`) vive AQUI, compartilhada, de propósito: o
// backend a usa pra carimbar a viagem e o app nativo a usa pra decidir o
// aviso/sugestão. Se cada lado tivesse a sua, o badge do painel e o aviso do
// motorista poderiam discordar sobre a MESMA viagem — e aí ninguém confia em
// nenhum dos dois. Uma função, uma verdade.

/** Procedência do km faturável — espelha o enum KmFonte do Prisma. */
export const KmFonte = z.enum(["ROTA_OSRM", "ROTA_ESCOLHIDA", "HISTORICO", "MANUAL"]);
export type KmFonte = z.infer<typeof KmFonte>;

/** Contra o que o km foi comparado — espelha FonteReferenciaKm do Prisma. */
export const FonteReferenciaKm = z.enum(["HISTORICO", "ROTA_OSRM"]);
export type FonteReferenciaKm = z.infer<typeof FonteReferenciaKm>;

/** Réguas da avaliação. Vem embutida em toda resposta de referência pro app
 *  poder aplicar a MESMA régua offline, sem um segundo endpoint pra cachear. */
export const ConfigKmAtipico = z.object({
  ativo: z.boolean(),
  desvioPct: z.number(),
  desvioPctOsrm: z.number(),
  amostraMinima: z.number(),
  janelaDias: z.number(),
  kmMinimoAvaliado: z.number(),
});
export type ConfigKmAtipico = z.infer<typeof ConfigKmAtipico>;

/** Estatística de um par carga→descarga a partir das viagens comparáveis. */
export type EstatisticaPar = {
  mediana: number;
  amostra: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
};

/** Payload de referência de um par — o que `avaliarKm` consome e o que os
 *  endpoints de referência devolvem (mais campos de UI conforme o caso). */
export type ReferenciaKmPayload = {
  historico: EstatisticaPar | null;
  osrm: { km: number } | null;
  /** A referência que efetivamente vale: histórico quando amostra >=
   *  amostraMinima, senão o OSRM. Null quando não há como comparar. */
  efetiva: { km: number; fonte: FonteReferenciaKm } | null;
  config: ConfigKmAtipico;
};

export type ResultadoAvaliacaoKm = {
  foraDoPadrao: boolean;
  /** (km − referência) / referência × 100. Positivo = viagem acima da referência. */
  desvioPct: number;
  fonte: FonteReferenciaKm;
  /** O valor de referência usado (mediana ou km OSRM), pra montar a mensagem. */
  referencia: number;
};

/**
 * Decide se o km de uma viagem está fora do padrão do trajeto. Pura e
 * determinística: mesma entrada, mesma saída, nos dois lados.
 *
 * Retorna `null` quando NÃO dá pra avaliar (config desligada, km curto demais,
 * ou sem referência) — o chamador trata null como "não avalia", nunca como
 * "está ok". A distinção importa: no app, null = sem banner; no backend,
 * null = kmForaDoPadrao fica null (não avaliado), não false.
 */
export function avaliarKm(
  km: number | null | undefined,
  ref: ReferenciaKmPayload | null | undefined,
): ResultadoAvaliacaoKm | null {
  if (ref == null) return null;
  if (!ref.config.ativo) return null;
  if (km == null || !Number.isFinite(km) || km <= 0) return null;
  if (km < ref.config.kmMinimoAvaliado) return null;
  if (ref.efetiva == null || ref.efetiva.km <= 0) return null;

  const referencia = ref.efetiva.km;
  const fonte = ref.efetiva.fonte;
  const desvioPct = ((km - referencia) / referencia) * 100;
  const regua = fonte === "HISTORICO" ? ref.config.desvioPct : ref.config.desvioPctOsrm;
  return {
    foraDoPadrao: Math.abs(desvioPct) > regua,
    desvioPct,
    fonte,
    referencia,
  };
}

// --- Config admin (validação da tela de tolerância) ---

export const AtualizarConfigKmAtipicoInput = z
  .object({
    ativo: z.boolean().optional(),
    desvioPct: z.number().int().min(5).max(300).optional(),
    desvioPctOsrm: z.number().int().min(5).max(300).optional(),
    amostraMinima: z.number().int().min(2).max(100).optional(),
    janelaDias: z.number().int().min(7).max(1825).optional(),
    kmMinimoAvaliado: z.number().min(0).max(9999).optional(),
  })
  .refine(
    (v) =>
      v.desvioPct == null || v.desvioPctOsrm == null || v.desvioPctOsrm >= v.desvioPct,
    {
      message: "A régua do OSRM deve ser >= a do histórico (o OSRM é menos confiável).",
      path: ["desvioPctOsrm"],
    },
  );
export type AtualizarConfigKmAtipicoInput = z.infer<typeof AtualizarConfigKmAtipicoInput>;
