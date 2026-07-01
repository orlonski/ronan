import { z } from "zod";

// Regra de mínimo faturado por empresa + material (ou "qualquer") + faixa de km.
// kmFaixaDe inclusivo; kmFaixaAte exclusivo (null/omitido = sem teto). Pelo menos
// um dos mínimos (km ou toneladas) precisa estar preenchido.

const temAlgumMinimo = (d: {
  kmMinimo?: number | null;
  toneladasMinimo?: number | null;
}) => d.kmMinimo != null || d.toneladasMinimo != null;

const faixaCoerente = (d: { kmFaixaDe?: number; kmFaixaAte?: number | null }) =>
  d.kmFaixaAte == null || d.kmFaixaDe == null || d.kmFaixaAte > d.kmFaixaDe;

export const CriarRegraMinimoInput = z
  .object({
    empresaId: z.string().uuid(),
    materialId: z.string().uuid().nullish(),
    kmFaixaDe: z.number().nonnegative().max(99999.99),
    kmFaixaAte: z.number().positive().max(99999.99).nullish(),
    kmMinimo: z.number().positive().max(99999.99).nullish(),
    toneladasMinimo: z.number().positive().max(99999.999).nullish(),
  })
  .refine(temAlgumMinimo, {
    message: "Informe pelo menos um mínimo (km ou toneladas).",
    path: ["kmMinimo"],
  })
  .refine(faixaCoerente, {
    message: "O 'até' precisa ser maior que o 'de'.",
    path: ["kmFaixaAte"],
  });
export type CriarRegraMinimoInput = z.infer<typeof CriarRegraMinimoInput>;

export const AtualizarRegraMinimoInput = z
  .object({
    empresaId: z.string().uuid().optional(),
    materialId: z.string().uuid().nullish(),
    kmFaixaDe: z.number().nonnegative().max(99999.99).optional(),
    kmFaixaAte: z.number().positive().max(99999.99).nullish(),
    kmMinimo: z.number().positive().max(99999.99).nullish(),
    toneladasMinimo: z.number().positive().max(99999.999).nullish(),
    ativo: z.boolean().optional(),
  })
  .refine(faixaCoerente, {
    message: "O 'até' precisa ser maior que o 'de'.",
    path: ["kmFaixaAte"],
  });
export type AtualizarRegraMinimoInput = z.infer<typeof AtualizarRegraMinimoInput>;
