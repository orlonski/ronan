import { z } from "zod";

/**
 * Vínculo do motorista com a transportadora (próprio, agregado, terceiro…).
 *
 * Catálogo por conta: cada empresa nomeia os vínculos dela e diz quais fotos
 * cada um exige no abastecimento. Molde do `tipo-servico.ts`.
 *
 * Não confundir com `Transportadora`: aquela é a FROTA (pessoa jurídica, com
 * CNPJ) e serve pra particionar quem enxerga o quê no painel. Um agregado
 * pertence à frota X **e** é agregado — as duas dimensões convivem.
 */
export const CriarModalidadeMotoristaInput = z.object({
  nome: z.string().min(2).max(60),
  // Quais comprovantes o abastecimento desse vínculo exige. Quando o motorista
  // TEM modalidade, `exigeFotoCupom` substitui o interruptor geral da conta —
  // é o que permite "própria não pede foto de nada".
  exigeFotoCupom: z.boolean().default(false),
  exigeFotoOdometro: z.boolean().default(false),
  exigeFotoBomba: z.boolean().default(false),
  ordem: z.number().int().min(0).max(999).default(0),
});
export type CriarModalidadeMotoristaInput = z.infer<typeof CriarModalidadeMotoristaInput>;

export const AtualizarModalidadeMotoristaInput = z.object({
  nome: z.string().min(2).max(60).optional(),
  ativo: z.boolean().optional(),
  exigeFotoCupom: z.boolean().optional(),
  exigeFotoOdometro: z.boolean().optional(),
  exigeFotoBomba: z.boolean().optional(),
  ordem: z.number().int().min(0).max(999).optional(),
});
export type AtualizarModalidadeMotoristaInput = z.infer<typeof AtualizarModalidadeMotoristaInput>;

/** Leitura: o que o painel e o app recebem. */
export const ModalidadeMotorista = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nome: z.string(),
  ativo: z.boolean(),
  ordem: z.number().int(),
  exigeFotoCupom: z.boolean(),
  exigeFotoOdometro: z.boolean(),
  exigeFotoBomba: z.boolean(),
});
export type ModalidadeMotorista = z.infer<typeof ModalidadeMotorista>;
