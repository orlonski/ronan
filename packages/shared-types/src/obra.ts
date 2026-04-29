import { z } from "zod";

export const CriarObraInput = z.object({
  nome: z.string().min(2).max(160),
  empresaClienteId: z.string().uuid(),
});
export type CriarObraInput = z.infer<typeof CriarObraInput>;

export const AtualizarObraInput = z.object({
  nome: z.string().min(2).max(160).optional(),
  empresaClienteId: z.string().uuid().optional(),
  ativa: z.boolean().optional(),
});
export type AtualizarObraInput = z.infer<typeof AtualizarObraInput>;
