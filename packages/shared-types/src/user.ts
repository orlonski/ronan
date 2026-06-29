import { z } from "zod";

export const CriarUserInput = z.object({
  nome: z.string().min(2).max(120),
  email: z.string().email(),
  senha: z.string().min(8).max(80),
  // Número WhatsApp pra receber o resumo diário (só dígitos ou formatado;
  // backend normaliza o DDI). Vazio = não recebe. null/"" limpa.
  whatsappResumo: z.string().max(20).nullish(),
  receberResumoDiario: z.boolean().optional(),
  // Assuntos do resumo que ESTE usuário recebe (preferência pessoal, separada
  // do papel). Vazio/ausente trata-se como "todos" no momento do envio.
  resumoAssuntos: z.array(z.string().min(1).max(40)).max(30).optional(),
  // Papel (RBAC) que define as permissões de acesso a telas.
  papelId: z.string().uuid().nullish(),
});
export type CriarUserInput = z.infer<typeof CriarUserInput>;

export const AtualizarUserInput = CriarUserInput.partial().extend({
  ativo: z.boolean().optional(),
});
export type AtualizarUserInput = z.infer<typeof AtualizarUserInput>;
