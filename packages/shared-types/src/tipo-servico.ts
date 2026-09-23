import { z } from "zod";

/**
 * Modo de serviço da conta: o que o lançamento da viagem exige. O admin
 * cadastra e o app monta o formulário a partir das flags — nada de fluxo
 * hardcoded por slug.
 *
 * ⚠️ Já existiu a medição por PERÍODO (diária, entrada→saída sem peso). Saiu
 * do sistema em 22/09/2026 sem nenhuma empresa ter usado; toda viagem é por peso.
 */
export const CriarTipoServicoInput = z.object({
  nome: z.string().min(2).max(60),
  // false = viagem sem material.
  exigeMaterial: z.boolean().default(true),
  // Combinado em E com Material.exigeTicket: basta um dos dois dispensar.
  exigeTicket: z.boolean().default(true),
  exigeLocalDescarga: z.boolean().default(true),
  exigeKm: z.boolean().default(true),
  ordem: z.number().int().min(0).max(999).default(0),
});
export type CriarTipoServicoInput = z.infer<typeof CriarTipoServicoInput>;

export const AtualizarTipoServicoInput = z.object({
  nome: z.string().min(2).max(60).optional(),
  ativo: z.boolean().optional(),
  exigeMaterial: z.boolean().optional(),
  exigeTicket: z.boolean().optional(),
  exigeLocalDescarga: z.boolean().optional(),
  exigeKm: z.boolean().optional(),
  ordem: z.number().int().min(0).max(999).optional(),
});
export type AtualizarTipoServicoInput = z.infer<typeof AtualizarTipoServicoInput>;

/** Leitura: o que o app e o painel recebem. */
export const TipoServico = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  nome: z.string(),
  ativo: z.boolean(),
  padrao: z.boolean(),
  ordem: z.number().int(),
  exigeMaterial: z.boolean(),
  exigeTicket: z.boolean(),
  exigeLocalDescarga: z.boolean(),
  exigeKm: z.boolean(),
});
export type TipoServico = z.infer<typeof TipoServico>;
