import { z } from "zod";

export const CriarClienteInput = z.object({
  nome: z.string().min(2).max(160),
  empresaId: z.string().uuid(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
  toneladasMinimas: z.number().positive().max(99999.999).nullish(),
  kmMinimos: z.number().positive().max(99999.99).nullish(),
});
export type CriarClienteInput = z.infer<typeof CriarClienteInput>;

export const AtualizarClienteInput = z.object({
  nome: z.string().min(2).max(160).optional(),
  empresaId: z.string().uuid().optional(),
  ativa: z.boolean().optional(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).optional(),
  toneladasMinimas: z.number().positive().max(99999.999).nullish(),
  kmMinimos: z.number().positive().max(99999.99).nullish(),
});
export type AtualizarClienteInput = z.infer<typeof AtualizarClienteInput>;
