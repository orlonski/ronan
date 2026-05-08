import { z } from "zod";
import { cpfDigits, isCpfValid } from "./cpf";

/**
 * Aceita CPF com ou sem máscara, normaliza pra 11 dígitos e valida pelos
 * dígitos verificadores. Saída sempre = 11 dígitos puros.
 */
const CpfSchema = z
  .string()
  .transform(cpfDigits)
  .refine((v) => v.length === 11, "CPF deve ter 11 dígitos")
  .refine((v) => isCpfValid(v), "CPF inválido");

export const CriarMotoristaInput = z.object({
  nome: z.string().min(2).max(120),
  cpf: CpfSchema,
  senha: z.string().min(6).max(80),
  telefone: z.string().max(20).optional(),
  veiculoDefaultId: z.string().uuid().optional(),
});
export type CriarMotoristaInput = z.infer<typeof CriarMotoristaInput>;

export const AtualizarMotoristaInput = z.object({
  nome: z.string().min(2).max(120).optional(),
  cpf: CpfSchema.optional(),
  telefone: z.string().max(20).optional(),
  veiculoDefaultId: z.string().uuid().nullable().optional(),
  ativo: z.boolean().optional(),
  novaSenha: z.string().min(6).max(80).optional(),
});
export type AtualizarMotoristaInput = z.infer<typeof AtualizarMotoristaInput>;
