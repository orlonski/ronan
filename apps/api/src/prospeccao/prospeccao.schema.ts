import { z } from "zod";
import { paginationQuerySchema } from "../common/pagination/pagination.schema";

/** Filtros da tela de captação. */
export const listLeadsSchema = paginationQuerySchema.extend({
  uf: z.string().trim().length(2).optional(),
  municipio: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  origem: z.string().trim().min(1).optional(),
  scoreMinimo: z.coerce.number().int().min(0).max(100).optional(),
  /**
   * O filtro que mais importa no dia a dia: sem telefone nem e-mail, o lead
   * não dá pra trabalhar — só pra mandar enriquecer.
   */
  comContato: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
});
export type ListLeadsParams = z.infer<typeof listLeadsSchema>;

/** Um toque registrado à mão pela tela. */
export const criarInteracaoSchema = z.object({
  canal: z.enum(["LIGACAO", "EMAIL", "WHATSAPP", "REUNIAO", "NOTA"]),
  desfecho: z.enum(["ENVIADO", "RESPONDEU", "SEM_RESPOSTA", "RECUSOU", "PEDIU_OPT_OUT"]),
  resumo: z.string().trim().max(2000).optional(),
});
export type CriarInteracaoInput = z.infer<typeof criarInteracaoSchema>;

export const atualizarLeadSchema = z.object({
  status: z.enum(["NOVO", "EM_CONTATO", "QUALIFICADO", "PROPOSTA", "GANHOU", "PERDEU"]).optional(),
  observacao: z.string().trim().max(4000).optional(),
  telefone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(160).optional(),
  socio: z.string().trim().max(160).optional(),
});
export type AtualizarLeadInput = z.infer<typeof atualizarLeadSchema>;
