import { z } from "zod";

/**
 * Faixa aceitável de densidade a granel, em t/m³. Pó de pedra solto passa de
 * 0,3 pra cima; minério pesado não chega a 3,5. Fora disso é quase sempre erro
 * de unidade — "1450" digitado em kg/m³ dividiria todo volume por mil. O banco
 * tem CHECK com a mesma faixa.
 */
export const DENSIDADE_MIN_T_M3 = 0.3;
export const DENSIDADE_MAX_T_M3 = 3.5;

/**
 * Densidade a granel do material em t/m³ (brita 1 ≈ 1,45; areia ≈ 1,5). É o
 * que converte o peso da balança no volume que o cliente compra. Opcional:
 * sem ela, pedido e preço em m³ ficam indisponíveis — nunca se chuta média.
 */
const FORA_DA_FAIXA = "A densidade fica entre 0,3 e 3,5 t/m³ (brita ≈ 1,45). Confira se não digitou em kg/m³.";
const densidadeTonM3 = z.coerce
  .number()
  .min(DENSIDADE_MIN_T_M3, FORA_DA_FAIXA)
  .max(DENSIDADE_MAX_T_M3, FORA_DA_FAIXA)
  .nullish();

export const CriarMaterialInput = z.object({
  nome: z.string().min(2).max(80),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
  // Se false, viagens desse material não exigem ticket (ex: concreto).
  exigeTicket: z.boolean().default(true),
  // Se true, o motorista pode marcar "voltar pro bota-fora" (limpeza): a perna
  // descarga→carga entra no km faturável. Controlado pelo admin.
  permiteBotaFora: z.boolean().default(false),
  // false = material que não gera papel nenhum (concreto). Suprime a exigência
  // de foto da empresa — não dá pra cobrar foto de comprovante inexistente.
  temComprovanteFoto: z.boolean().default(true),
  // true = a viagem desse material já entra APROVADA, sem passar por
  // conferência. Independente de `temComprovanteFoto`: aquela decide a FOTO,
  // esta decide a CONFERÊNCIA. Nasce desligada.
  dispensaConferencia: z.boolean().default(false),
  /**
   * R$ por tonelada da MERCADORIA — não do frete.
   *
   * O CT-e exige o valor da carga no modal rodoviário (rejeição 581) e o
   * sistema não tem de onde deduzi-lo: a tabela de preços precifica o SERVIÇO.
   * Aqui o contador informa uma referência de mercado por material, e o valor
   * da carga sai de `referência × toneladas`. Quando a viagem traz o valor real
   * (da NF-e), ele vence esta referência.
   */
  valorReferenciaTonelada: z.coerce.number().nonnegative().max(9_999_999).nullish(),
  densidadeTonM3,
});
export type CriarMaterialInput = z.infer<typeof CriarMaterialInput>;

export const AtualizarMaterialInput = z.object({
  nome: z.string().min(2).max(80).optional(),
  ativo: z.boolean().optional(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).optional(),
  exigeTicket: z.boolean().optional(),
  permiteBotaFora: z.boolean().optional(),
  temComprovanteFoto: z.boolean().optional(),
  dispensaConferencia: z.boolean().optional(),
  /**
   * R$ por tonelada da MERCADORIA — não do frete.
   *
   * O CT-e exige o valor da carga no modal rodoviário (rejeição 581) e o
   * sistema não tem de onde deduzi-lo: a tabela de preços precifica o SERVIÇO.
   * Aqui o contador informa uma referência de mercado por material, e o valor
   * da carga sai de `referência × toneladas`. Quando a viagem traz o valor real
   * (da NF-e), ele vence esta referência.
   */
  valorReferenciaTonelada: z.coerce.number().nonnegative().max(9_999_999).nullish(),
  densidadeTonM3,
});
export type AtualizarMaterialInput = z.infer<typeof AtualizarMaterialInput>;
