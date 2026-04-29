import { z } from "zod";

export const CriarMotoristaInput = z.object({
  nome: z.string().min(2).max(120),
  usuario: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/, "Apenas letras minúsculas, números, ., _ ou -"),
  senha: z.string().min(6).max(80),
  telefone: z.string().max(20).optional(),
  veiculoDefaultId: z.string().uuid().optional(),
});
export type CriarMotoristaInput = z.infer<typeof CriarMotoristaInput>;

export const AtualizarMotoristaInput = z.object({
  nome: z.string().min(2).max(120).optional(),
  telefone: z.string().max(20).optional(),
  veiculoDefaultId: z.string().uuid().nullable().optional(),
  ativo: z.boolean().optional(),
  novaSenha: z.string().min(6).max(80).optional(),
});
export type AtualizarMotoristaInput = z.infer<typeof AtualizarMotoristaInput>;
