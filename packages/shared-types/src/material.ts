import { z } from "zod";

export const CriarMaterialInput = z.object({
  nome: z.string().min(2).max(80),
  apelidos: z.array(z.string().min(1).max(60)).max(20).default([]),
});
export type CriarMaterialInput = z.infer<typeof CriarMaterialInput>;

export const AtualizarMaterialInput = z.object({
  nome: z.string().min(2).max(80).optional(),
  ativo: z.boolean().optional(),
  apelidos: z.array(z.string().min(1).max(60)).max(20).optional(),
});
export type AtualizarMaterialInput = z.infer<typeof AtualizarMaterialInput>;
