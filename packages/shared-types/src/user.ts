import { z } from "zod";

const CriarUserBase = z.object({
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
  // Escopo de acesso: `true` (default) vê todos os registros; `false` restringe
  // às transportadoras de `transportadoraIds`. Editar exige "permissoes.gerenciar"
  // — é RBAC, não dado cadastral.
  acessoGlobal: z.boolean().optional(),
  transportadoraIds: z.array(z.string().uuid()).max(50).optional(),
});

const AtualizarUserBase = CriarUserBase.partial().extend({
  ativo: z.boolean().optional(),
});

/**
 * Restringir sem vincular nenhuma transportadora resulta num usuário que não vê
 * NADA (o filtro vira `in: []`). É um estado válido no banco — e é o default
 * seguro —, mas nunca é o que alguém quis fazer pela tela. Barra na entrada.
 */
function exigeTransportadoraQuandoRestrito(
  v: { acessoGlobal?: boolean; transportadoraIds?: string[] },
  ctx: z.RefinementCtx,
) {
  if (v.acessoGlobal === false && (v.transportadoraIds?.length ?? 0) === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transportadoraIds"],
      message: "Escolha pelo menos uma transportadora pra restringir o acesso.",
    });
  }
}

export const CriarUserInput = CriarUserBase.superRefine(exigeTransportadoraQuandoRestrito);
export type CriarUserInput = z.infer<typeof CriarUserInput>;

export const AtualizarUserInput = AtualizarUserBase.superRefine(
  exigeTransportadoraQuandoRestrito,
);
export type AtualizarUserInput = z.infer<typeof AtualizarUserInput>;
