import { z } from "zod";

/**
 * A vala de segurança dos lançamentos do motorista.
 *
 * Regra que a coisa toda existe pra garantir: **lançamento que o motorista fez
 * não some**. Hoje, quando o outbox recusa um item de vez (4xx — placa que saiu
 * do cadastro, cliente apagado, ticket duplicado), o conteúdo dele existe em um
 * lugar só: dentro do celular. Se o motorista descarta pra limpar a tela, se
 * troca de aparelho ou se reinstala o app, a viagem evapora — e ninguém no
 * escritório chega a saber que ela existiu.
 *
 * Então, no momento em que o item para de retentar, o app manda o payload cru
 * pra cá. Nada aqui aponta pra cadastro nenhum (o payload é JSON solto): é
 * exatamente por isso que essa gravação não pode falhar pelo mesmo motivo que
 * derrubou o lançamento original.
 *
 * Não é a fila de sincronização — é a cópia de segurança dela. O item continua
 * no celular e continua podendo ser corrigido lá; isso aqui é a garantia de que
 * existe uma segunda cópia quando o celular não colaborar.
 */

/** Tipos que carregam dado de negócio — foto/story/mensagem ficam de fora. */
export const TIPOS_RESGATE = [
  "viagem",
  "viagem-iniciar",
  "viagem-finalizar",
  "pedagio",
  "abastecimento",
  "local",
  "completar-peso",
] as const;
export const TipoResgate = z.enum(TIPOS_RESGATE);
export type TipoResgate = z.infer<typeof TipoResgate>;

export const ResgatarLancamentoInput = z.object({
  /** O mesmo clientId do outbox: reenvio atualiza a linha, não duplica. */
  clientId: z.string().min(1).max(80),
  tipo: TipoResgate,
  /** Payload cru, do jeito que o app tentou enviar. */
  payload: z.record(z.unknown()),
  /** Mensagem que o servidor devolveu quando recusou. */
  erroMensagem: z.string().max(500).optional(),
  erroStatus: z.number().int().min(100).max(599).optional(),
  criadoOfflineEm: z.coerce.date().optional(),
});
export type ResgatarLancamentoInput = z.infer<typeof ResgatarLancamentoInput>;

/**
 * Como o caso foi encerrado.
 *
 * `SUBIU_SOZINHO` é carimbado pelo próprio backend quando o lançamento com
 * aquele clientId acaba entrando (o motorista corrigiu no app, ou o cadastro
 * voltou). Sem isso a tela viraria um monte de caso já resolvido, e uma tela
 * cheia de ruído é uma tela que ninguém abre.
 */
export const RESOLUCOES_RESGATE = [
  "SUBIU_SOZINHO",
  "LANCADO_NO_PAINEL",
  "DESCARTADO",
] as const;
export const ResolucaoResgate = z.enum(RESOLUCOES_RESGATE);
export type ResolucaoResgate = z.infer<typeof ResolucaoResgate>;

export const ResolverResgateInput = z.object({
  // SUBIU_SOZINHO fica de fora de propósito: é carimbo do servidor, não escolha
  // de quem está na tela.
  resolucao: z.enum(["LANCADO_NO_PAINEL", "DESCARTADO"]),
  observacao: z.string().max(300).optional(),
});
export type ResolverResgateInput = z.infer<typeof ResolverResgateInput>;

/**
 * Um campo do payload já traduzido pra tela: o rótulo que o motorista vê, o
 * valor, e — quando é referência a cadastro — se ele ainda existe.
 *
 * `existe: false` é o diagnóstico pronto: é ele que diz, sem ninguém precisar
 * cruzar id na mão, que o lançamento morreu porque a placa foi excluída.
 */
export type CampoResgatado = {
  rotulo: string;
  valor: string;
  existe?: boolean;
};

export type LancamentoResgatadoItem = {
  id: string;
  clientId: string;
  tipo: TipoResgate;
  motorista: { id: string; nome: string };
  erroMensagem: string | null;
  erroStatus: number | null;
  appVersao: string | null;
  criadoOfflineEm: string | null;
  recebidoEm: string;
  resolucao: ResolucaoResgate | null;
  resolvidoEm: string | null;
  resolvidoPorNome: string | null;
  observacao: string | null;
  /** Leitura amigável do payload, com as referências já conferidas. */
  campos: CampoResgatado[];
  /** O payload cru, pro caso de precisar do que a leitura amigável não mostra. */
  payload: Record<string, unknown>;
};
