import { z } from "zod";

/**
 * Tipos conhecidos hoje. O wire mantém `tipo` como `string` aberta pra app
 * antigo não quebrar quando novos tipos forem adicionados no backend.
 */
export const TipoNotificacao = z.enum(["mensagem-admin"]);
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
