import { z } from "zod";
import { cpfDigits, isCpfValid } from "./cpf";
import { isTelefoneValid, telefoneDigits } from "./telefone";

/**
 * Aceita CPF com ou sem máscara, normaliza pra 11 dígitos e valida pelos
 * dígitos verificadores. Saída sempre = 11 dígitos puros.
 */
const CpfSchema = z
  .string()
  .transform(cpfDigits)
  .refine((v) => v.length === 11, "CPF deve ter 11 dígitos")
  .refine((v) => isCpfValid(v), "CPF inválido");

/**
 * Telefone opcional. Aceita com ou sem máscara, normaliza pra dígitos puros.
 * Strings vazias viram undefined.
 */
const TelefoneOpcionalSchema = z
  .preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      const d = telefoneDigits(v);
      return d === "" ? undefined : d;
    },
    z.string().refine(isTelefoneValid, "Telefone deve ter 10 ou 11 dígitos").optional(),
  );

/**
 * Email opcional. Trim, lowercase. String vazia vira undefined.
 */
const EmailOpcionalSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" ? undefined : t.toLowerCase();
  },
  z.string().email("Email inválido").optional(),
);

export const CriarMotoristaInput = z.object({
  nome: z.string().min(2).max(120),
  cpf: CpfSchema,
  senha: z.string().min(6).max(80),
  telefone: TelefoneOpcionalSchema,
  email: EmailOpcionalSchema,
  veiculoDefaultId: z.string().uuid().optional(),
});
export type CriarMotoristaInput = z.infer<typeof CriarMotoristaInput>;

export const AtualizarMotoristaInput = z.object({
  nome: z.string().min(2).max(120).optional(),
  cpf: CpfSchema.optional(),
  telefone: TelefoneOpcionalSchema,
  email: EmailOpcionalSchema,
  veiculoDefaultId: z.string().uuid().nullable().optional(),
  ativo: z.boolean().optional(),
  novaSenha: z.string().min(6).max(80).optional(),
});
export type AtualizarMotoristaInput = z.infer<typeof AtualizarMotoristaInput>;
