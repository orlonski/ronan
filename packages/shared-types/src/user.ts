import { z } from "zod";
import { PerfilUsuario } from "./enums";

export const CriarUserInput = z.object({
  nome: z.string().min(2).max(120),
  email: z.string().email(),
  senha: z.string().min(8).max(80),
  perfil: z.nativeEnum(PerfilUsuario).default(PerfilUsuario.OPERADOR),
});
export type CriarUserInput = z.infer<typeof CriarUserInput>;

export const AtualizarUserInput = CriarUserInput.partial().extend({
  ativo: z.boolean().optional(),
});
export type AtualizarUserInput = z.infer<typeof AtualizarUserInput>;
