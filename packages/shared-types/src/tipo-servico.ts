import { z } from "zod";

/**
 * Como a viagem é MEDIDA — e portanto o que o app pede ao motorista.
 *
 * PESO    = toneladas transportadas (o padrão de sempre).
 * PERIODO = tempo em que o caminhão ficou à disposição (diária): entrada→saída,
 *           sem peso.
 */
export const MedicaoViagem = z.enum(["PESO", "PERIODO"]);
export type MedicaoViagem = z.infer<typeof MedicaoViagem>;

/**
 * Modo de serviço da conta. Existe porque "diária" não é um material: é a
 * unidade de medida do serviço. O admin cadastra e o app monta o formulário a
 * partir das flags — nada de fluxo hardcoded por slug.
 */
export const CriarTipoServicoInput = z.object({
  nome: z.string().min(2).max(60),
  medicao: MedicaoViagem.default("PESO"),
  // false = viagem sem material (diária de caminhão à disposição).
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
  // `medicao` NÃO entra aqui de propósito: virar a medição de um tipo que já
  // tem viagens lançadas transformaria peso em período (e vice-versa) no
  // histórico inteiro, de uma vez. Pra mudar, cria-se outro tipo.
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
  medicao: MedicaoViagem,
  exigeMaterial: z.boolean(),
  exigeTicket: z.boolean(),
  exigeLocalDescarga: z.boolean(),
  exigeKm: z.boolean(),
});
export type TipoServico = z.infer<typeof TipoServico>;

/**
 * Duração em minutos entre entrada e saída. Fonte única — backend (gravação em
 * Viagem.duracaoMinutos), painel e app usam esta mesma conta pra nunca
 * divergirem no arredondamento.
 *
 * Aceita a virada da noite naturalmente porque entrada/saída são DateTime
 * completos, não "hora do dia": diária 22h→06h dá 480, não -960.
 */
export function duracaoMinutos(entradaEm: Date, saidaEm: Date): number {
  return Math.round((saidaEm.getTime() - entradaEm.getTime()) / 60000);
}

/** "4h20", "45min", "1d 2h10" — rótulo curto de permanência pro app e painel. */
export function formatarDuracao(minutos: number | null | undefined): string {
  if (minutos == null || !Number.isFinite(minutos) || minutos < 0) return "—";
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const min = minutos % 60;
  if (dias > 0) return `${dias}d ${horas}h${String(min).padStart(2, "0")}`;
  if (horas > 0) return `${horas}h${String(min).padStart(2, "0")}`;
  return `${min}min`;
}
