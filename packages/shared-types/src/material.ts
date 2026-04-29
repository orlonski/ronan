import { z } from "zod";

export const CriarMaterialInput = z.object({
  nome: z.string().min(2).max(80),
});
export type CriarMaterialInput = z.infer<typeof CriarMaterialInput>;

export const AtualizarMaterialInput = z.object({
  nome: z.string().min(2).max(80).optional(),
  ativo: z.boolean().optional(),
});
export type AtualizarMaterialInput = z.infer<typeof AtualizarMaterialInput>;
