import { z } from "zod";

export const CriarMaterialInput = z.object({
  nome: z.string().min(2).max(80),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
  // Se false, viagens desse material não exigem ticket (ex: concreto).
  exigeTicket: z.boolean().default(true),
  // Se true, o motorista pode marcar "voltar pro bota-fora" (limpeza): a perna
  // descarga→carga entra no km faturável. Controlado pelo admin.
  permiteBotaFora: z.boolean().default(false),
});
export type CriarMaterialInput = z.infer<typeof CriarMaterialInput>;

export const AtualizarMaterialInput = z.object({
  nome: z.string().min(2).max(80).optional(),
  ativo: z.boolean().optional(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).optional(),
  exigeTicket: z.boolean().optional(),
  permiteBotaFora: z.boolean().optional(),
});
export type AtualizarMaterialInput = z.infer<typeof AtualizarMaterialInput>;
