import { z } from "zod";
import { cpfDigits } from "./cpf";

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

export type AuthUser =
  | { kind: "ADMIN_USER"; id: string; nome: string; email: string }
  | { kind: "MOTORISTA"; id: string; nome: string; cpf: string };
