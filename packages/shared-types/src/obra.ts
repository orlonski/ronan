import { z } from "zod";

export const CriarObraInput = z.object({
  nome: z.string().min(2).max(160),
  empresaClienteId: z.string().uuid(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type CriarObraInput = z.infer<typeof CriarObraInput>;

export const AtualizarObraInput = z.object({
  nome: z.string().min(2).max(160).optional(),
  empresaClienteId: z.string().uuid().optional(),
  ativa: z.boolean().optional(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).optional(),
});
export type AtualizarObraInput = z.infer<typeof AtualizarObraInput>;
