import { z } from "zod";
import { UnidadePedidoSchema, type UnidadePedidoTipo, type StatusViagemPlanejadaTipo } from "./pedido";

/**
 * O encarregado da obra: gente do CLIENTE da transportadora, que entra no
 * portal `/obra` pelo celular com um código no WhatsApp.
 *
 * Tudo que sai pra ele é montado campo a campo (whitelist) no backend — os
 * tipos de resposta abaixo são o contrato inteiro do que ele pode ver. Campo
 * novo aqui é decisão, não efeito colateral.
 */

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use uma hora no formato HH:MM.");

/** Telefone digitado do jeito que a pessoa digita: a normalização é no servidor. */
const TELEFONE = z
  .string()
  .trim()
  .min(10, "Informe o celular com DDD.")
  .max(20, "Informe o celular com DDD.");

// ------------------------------------------------------------ portal (público)

export const SolicitarCodigoEncarregadoInput = z.object({ telefone: TELEFONE });
export type SolicitarCodigoEncarregadoInput = z.infer<typeof SolicitarCodigoEncarregadoInput>;

export const ConfirmarCodigoEncarregadoInput = z.object({
  telefone: TELEFONE,
  codigo: z.string().trim().regex(/^\d{6}$/, "O código tem 6 números."),
});
export type ConfirmarCodigoEncarregadoInput = z.infer<typeof ConfirmarCodigoEncarregadoInput>;

/** "Preciso de caminhão": em viagens OU em toneladas, como a obra pensa. */
export const PedirCaminhaoInput = z.object({
  data: DATA,
  quantidade: z.number().positive("Diga quantas.").max(500, "Pra mais de 500, fale com o escritório."),
  unidade: UnidadePedidoSchema.default("VIAGENS"),
  materialId: z.string().uuid().nullish(),
  observacao: z.string().trim().max(500).nullish(),
});
export type PedirCaminhaoInput = z.infer<typeof PedirCaminhaoInput>;

export const STATUS_SOLICITACAO_OBRA = ["PENDENTE", "CONFIRMADA", "RECUSADA"] as const;
export type StatusSolicitacaoObraTipo = (typeof STATUS_SOLICITACAO_OBRA)[number];

export const STATUS_SOLICITACAO_OBRA_LABEL: Record<StatusSolicitacaoObraTipo, string> = {
  PENDENTE: "Esperando o escritório",
  CONFIRMADA: "Confirmado",
  RECUSADA: "Não deu",
};

/** Uma sessão por obra: o mesmo celular pode ser encarregado de várias. */
export type SessaoPortalObra = {
  token: string;
  expiraEm: string;
  obra: { nome: string };
  /** A transportadora — é a marca que o portal mostra. */
  empresa: { nome: string; logoUrl: string | null };
};

export type PortalObraMarca = { nome: string; logoUrl: string | null };

export type PortalObraPedido = {
  numero: number;
  material: string | null;
  unidade: UnidadePedidoTipo;
  contratado: string;
  /**
   * Null quando o pedido é em m³ e o material ainda não tem densidade: o
   * volume não dá pra afirmar, e "0 entregue" seria mentira. O peso entregue
   * (fato da balança) vem em `entregueToneladas`.
   */
  entregue: string | null;
  saldo: string | null;
  percentual: number | null;
  entregueToneladas: string | null;
  viagens: number;
  prazoEm: string | null;
  situacao: string;
  /** Só com `podeVerValores`. */
  valorEntregue?: string | null;
};

export type PortalObraSolicitacao = {
  id: string;
  data: string;
  quantidade: string;
  unidade: UnidadePedidoTipo;
  material: string | null;
  observacao: string | null;
  status: StatusSolicitacaoObraTipo;
  recusaMotivo: string | null;
  viagensProgramadas: number | null;
  criadoEm: string;
};

export type PortalObraResumo = {
  marca: PortalObraMarca;
  obra: { nome: string };
  encarregado: { nome: string; podeVerValores: boolean; podePedirCaminhao: boolean };
  pedidos: PortalObraPedido[];
  solicitacoes: PortalObraSolicitacao[];
  materiais: { id: string; nome: string }[];
};

export type PortalObraProgramada = {
  id: string;
  data: string;
  janelaInicio: string | null;
  janelaFim: string | null;
  status: StatusViagemPlanejadaTipo;
  /** Linguagem de cliente, não o rótulo interno do quadro. */
  situacao: string;
  material: string | null;
  placa: string | null;
  pedidoNumero: number | null;
  aprovadaEm: string | null;
  podeAprovar: boolean;
};

export type PortalObraTicket = {
  id: string;
  data: string;
  /** "HH:MM" em Brasília: quando a viagem foi registrada. */
  hora: string | null;
  placa: string;
  material: string | null;
  ticket: string | null;
  /** Toneladas EFETIVAS (as que contam pra obra). */
  toneladas: string | null;
  fotos: { id: string; rotacao: number }[];
  /** Só com `podeVerValores`. */
  valor?: string | null;
};

// --------------------------------------------------------------- painel admin

export const ConvidarEncarregadoInput = z.object({
  nome: z.string().trim().min(2, "Diga o nome.").max(120),
  telefone: TELEFONE,
  podeVerValores: z.boolean().default(false),
  podePedirCaminhao: z.boolean().default(true),
});
export type ConvidarEncarregadoInput = z.infer<typeof ConvidarEncarregadoInput>;

export const AtualizarEncarregadoInput = z.object({
  nome: z.string().trim().min(2).max(120).optional(),
  ativo: z.boolean().optional(),
  podeVerValores: z.boolean().optional(),
  podePedirCaminhao: z.boolean().optional(),
});
export type AtualizarEncarregadoInput = z.infer<typeof AtualizarEncarregadoInput>;

/**
 * O escritório confirma o pedido da obra: encaixa num pedido (ou deixa o
 * sistema criar um com o que a obra pediu) e programa N viagens no dia.
 */
export const ConfirmarSolicitacaoObraInput = z.object({
  /** Null = criar um pedido novo pra obra com o que ela pediu. */
  pedidoId: z.string().uuid().nullish(),
  viagens: z.number().int().min(1, "Programe pelo menos 1 viagem.").max(30),
  motoristaId: z.string().uuid().nullish(),
  veiculoId: z.string().uuid().nullish(),
  janelaInicio: HORA.nullish(),
});
export type ConfirmarSolicitacaoObraInput = z.infer<typeof ConfirmarSolicitacaoObraInput>;

export const RecusarSolicitacaoObraInput = z.object({
  // A obra lê o motivo no portal: recusar sem dizer por quê é deixar o cliente
  // ligando pro escritório pra perguntar.
  motivo: z.string().trim().min(3, "Diga o motivo — a obra vai ler.").max(300),
});
export type RecusarSolicitacaoObraInput = z.infer<typeof RecusarSolicitacaoObraInput>;
