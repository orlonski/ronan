import { z } from "zod";

/**
 * Tipos conhecidos hoje. O wire mantém `tipo` como `string` aberta pra app
 * antigo não quebrar quando novos tipos forem adicionados no backend.
 */
export const TipoNotificacao = z.enum([
  "mensagem-admin",
  "viagem-divergente",
  "viagem-conferida",
  "viagem-editada",
]);
export type TipoNotificacao = z.infer<typeof TipoNotificacao>;

export type NotificacaoItem = {
  id: string;
  tipo: string;
  titulo: string;
  corpo: string;
  dados: Record<string, unknown> | null;
  lida: boolean;
  lidaEm: string | null;
  criadoEm: string;
};

export const ListarNotificacoesQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type ListarNotificacoesQuery = z.infer<typeof ListarNotificacoesQuery>;

export type ListarNotificacoesResponse = {
  itens: NotificacaoItem[];
  nextCursor: string | null;
  naoLidas: number;
};

// ===== Admin (dashboard) =====

export const NotificacaoEntregaStatusEnum = z.enum(["PENDENTE", "ENTREGUE", "ERRO"]);
export type NotificacaoEntregaStatusEnum = z.infer<typeof NotificacaoEntregaStatusEnum>;

export const ListarNotificacoesAdminQuery = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  motoristaId: z.string().uuid().optional(),
  entregaStatus: NotificacaoEntregaStatusEnum.optional(),
  lida: z
    .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean().optional()),
});
export type ListarNotificacoesAdminQuery = z.infer<typeof ListarNotificacoesAdminQuery>;

export type NotificacaoAdminItem = {
  id: string;
  motorista: { id: string; nome: string; cpf: string };
  tipo: string;
  titulo: string;
  corpo: string;
  dados: Record<string, unknown> | null;
  lida: boolean;
  lidaEm: string | null;
  entregaStatus: NotificacaoEntregaStatusEnum;
  entregaErro: string | null;
  expoTicketId: string | null;
  criadoEm: string;
  criadoPor: { id: string; nome: string } | null;
};

export type ListarNotificacoesAdminResponse = {
  itens: NotificacaoAdminItem[];
  nextCursor: string | null;
};
