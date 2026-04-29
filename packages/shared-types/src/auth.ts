import { z } from "zod";
import { PerfilUsuario } from "./enums";

export const LoginInput = z.object({
  email: z.string().email(),
  senha: z.string().min(6),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const LoginMotoristaInput = z.object({
  usuario: z.string().min(2).max(60),
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
  | { kind: "ADMIN_USER"; id: string; nome: string; email: string; perfil: PerfilUsuario }
  | { kind: "MOTORISTA"; id: string; nome: string; usuario: string };
