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

const placaRegex = /^[A-Z]{3}-?\d[A-Z\d]\d{2}$/i;

/**
 * Placa vinculada ao motorista. Backend faz upsert: se placa existe, vincula
 * (e atualiza modelo se vier); se não existe, cria veículo novo e vincula.
 * Placa é única por veículo (mas pode estar em vários motoristas via N:N).
 */
const PlacaInput = z.object({
  placa: z
    .string()
    .trim()
    .toUpperCase()
    .regex(placaRegex, "Placa inválida (formato Mercosul: ABC1D23 ou antigo: ABC1234)"),
  modelo: z.string().max(80).optional(),
});
export type PlacaInput = z.infer<typeof PlacaInput>;

/**
 * Garante que não tem placas duplicadas no array (mesma placa repetida no form).
 */
function placasSemDuplicatas(placas: PlacaInput[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  for (let i = 0; i < placas.length; i++) {
    const p = placas[i]!.placa;
    if (seen.has(p)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placas", i, "placa"],
        message: "Placa repetida",
      });
    }
    seen.add(p);
  }
}

export const CriarMotoristaInput = z
  .object({
    nome: z.string().min(2).max(120),
    cpf: CpfSchema,
    senha: z.string().min(6).max(80),
    telefone: TelefoneOpcionalSchema,
    email: EmailOpcionalSchema,
    placas: z.array(PlacaInput).default([]),
    /** Placa default — string (não id). Backend resolve pro id após upsert. */
    placaDefault: z
      .string()
      .trim()
      .toUpperCase()
      .regex(placaRegex)
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    placasSemDuplicatas(v.placas, ctx);
    if (v.placaDefault && !v.placas.some((p) => p.placa === v.placaDefault)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placaDefault"],
        message: "Placa padrão precisa estar na lista de placas",
      });
    }
  });
export type CriarMotoristaInput = z.infer<typeof CriarMotoristaInput>;

export const AtualizarMotoristaInput = z
  .object({
    nome: z.string().min(2).max(120).optional(),
    cpf: CpfSchema.optional(),
    telefone: TelefoneOpcionalSchema,
    email: EmailOpcionalSchema,
    placas: z.array(PlacaInput).optional(),
    placaDefault: z
      .string()
      .trim()
      .toUpperCase()
      .regex(placaRegex)
      .nullable()
      .optional(),
    ativo: z.boolean().optional(),
    novaSenha: z.string().min(6).max(80).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.placas) placasSemDuplicatas(v.placas, ctx);
    if (v.placaDefault && v.placas && !v.placas.some((p) => p.placa === v.placaDefault)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placaDefault"],
        message: "Placa padrão precisa estar na lista de placas",
      });
    }
  });
export type AtualizarMotoristaInput = z.infer<typeof AtualizarMotoristaInput>;
