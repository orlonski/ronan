import { z } from "zod";
import { PerfilUsuario } from "./enums";

export const CriarUserInput = z.object({
  nome: z.string().min(2).max(120),
  email: z.string().email(),
  senha: z.string().min(8).max(80),
  perfil: z.nativeEnum(PerfilUsuario).default(PerfilUsuario.OPERADOR),
  // Número WhatsApp pra receber o resumo diário (só dígitos ou formatado;
  // backend normaliza o DDI). Vazio = não recebe. null/"" limpa.
  whatsappResumo: z.string().max(20).nullish(),
  receberResumoDiario: z.boolean().optional(),
  // Papel (RBAC) que define as permissões granulares do usuário.
  papelId: z.string().uuid().nullish(),
});
export type CriarUserInput = z.infer<typeof CriarUserInput>;

export const AtualizarUserInput = CriarUserInput.partial().extend({
  ativo: z.boolean().optional(),
});
export type AtualizarUserInput = z.infer<typeof AtualizarUserInput>;
