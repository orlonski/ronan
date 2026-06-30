import { z } from "zod";
import { cpfDigits } from "./cpf";
import { isTelefoneValid, telefoneDigits } from "./telefone";

// CPF leniente (igual ao login): só dígitos + 11 de comprimento, sem checar os
// verificadores. Mantém o erro genérico — não vaza se o CPF "existe" ou não.
const CpfLenienteSchema = z
  .string()
  .transform(cpfDigits)
  .refine((v) => v.length === 11, "CPF deve ter 11 dígitos");

// Telefone obrigatório (pra onde vai o código de reset). Normaliza pra dígitos.
const TelefoneResetSchema = z.preprocess(
  (v) => (typeof v === "string" ? telefoneDigits(v) : v),
  z.string().refine(isTelefoneValid, "Celular deve ter 10 ou 11 dígitos"),
);

export const LoginInput = z.object({
  email: z.string().email(),
  senha: z.string().min(6),
});
export type LoginInput = z.infer<typeof LoginInput>;

// Login do motorista: aceita CPF com ou sem máscara, normaliza pra dígitos.
// Aqui não validamos os dígitos verificadores pra não vazar info no erro
// (login com CPF inválido devolve "Credenciais inválidas" igual a senha errada).
export const LoginMotoristaInput = z.object({
  cpf: z
    .string()
    .transform(cpfDigits)
    .refine((v) => v.length === 11, "CPF deve ter 11 dígitos"),
  senha: z.string().min(6),
});
export type LoginMotoristaInput = z.infer<typeof LoginMotoristaInput>;

export const RefreshInput = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshInput = z.infer<typeof RefreshInput>;

export const TokensOutput = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type TokensOutput = z.infer<typeof TokensOutput>;

export const TrocarSenhaInput = z.object({
  senhaAtual: z.string().min(6),
  novaSenha: z.string().min(6),
});
export type TrocarSenhaInput = z.infer<typeof TrocarSenhaInput>;

// ---- Recuperação de senha do motorista (esqueci a senha) ----

/**
 * Passo 1: pede o código de redefinição. Informa CPF + celular.
 * - Se o CPF já tem celular cadastrado, o digitado precisa ser o MESMO.
 * - Se não tem celular cadastrado, o digitado é vinculado (após confirmar o
 *   código), desde que não pertença a outro CPF.
 * O código é sempre enviado pelo backend pro número de destino — nunca devolve
 * info que permita enumerar cadastros.
 */
export const EsqueciSenhaInput = z.object({
  cpf: CpfLenienteSchema,
  telefone: TelefoneResetSchema,
});
export type EsqueciSenhaInput = z.infer<typeof EsqueciSenhaInput>;

/** Reenvia o código de redefinição pro CPF (respeita cooldown/limites). */
export const ReenviarSenhaInput = z.object({
  cpf: CpfLenienteSchema,
});
export type ReenviarSenhaInput = z.infer<typeof ReenviarSenhaInput>;

/** Passo 2: confirma o código e define a nova senha. */
export const RedefinirSenhaInput = z.object({
  cpf: CpfLenienteSchema,
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Código deve ter 6 dígitos"),
  novaSenha: z.string().min(6, "Senha deve ter ao menos 6 caracteres").max(80),
});
export type RedefinirSenhaInput = z.infer<typeof RedefinirSenhaInput>;

export type AuthUser =
  | { kind: "ADMIN_USER"; id: string; nome: string; email: string }
  | { kind: "MOTORISTA"; id: string; nome: string; cpf: string };
