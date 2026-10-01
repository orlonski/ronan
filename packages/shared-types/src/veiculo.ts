import { z } from "zod";

const placaRegex = /^[A-Z]{3}-?\d[A-Z\d]\d{2}$/i;

export const CriarVeiculoInput = z.object({
  placa: z
    .string()
    .trim()
    .toUpperCase()
    .regex(placaRegex, "Placa inválida (formato Mercosul: ABC1D23 ou antigo: ABC1234)"),
  modelo: z.string().max(80).optional(),
  /// Litros do tanque de diesel. Opcional; serve pra conferir abastecimento.
  capacidadeTanqueLitros: z.number().int().positive().max(5000).nullish(),
  /// Meta de km/l. Opcional; abastecimento bem abaixo dela aparece pra conferir.
  metaKmL: z.number().positive().max(50).nullish(),
  /// Frota dona do caminhão. Null = não classificado.
  transportadoraId: z.string().uuid().nullish(),
});
export type CriarVeiculoInput = z.infer<typeof CriarVeiculoInput>;

export const AtualizarVeiculoInput = z.object({
  modelo: z.string().max(80).optional(),
  ativo: z.boolean().optional(),
  /// Litros do tanque de diesel. Opcional; serve pra conferir abastecimento.
  capacidadeTanqueLitros: z.number().int().positive().max(5000).nullish(),
  /// Meta de km/l. Opcional; abastecimento bem abaixo dela aparece pra conferir.
  metaKmL: z.number().positive().max(50).nullish(),
  transportadoraId: z.string().uuid().nullish(),
});
export type AtualizarVeiculoInput = z.infer<typeof AtualizarVeiculoInput>;
