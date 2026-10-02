import type { Prisma, StatusSolicitacaoObra, StatusViagemPlanejada, UnidadePedido } from "@prisma/client";
import type {
  PortalObraPedido,
  PortalObraProgramada,
  PortalObraSolicitacao,
  PortalObraTicket,
} from "@ronan/shared-types";
import { SITUACAO_PEDIDO_TEXTO, type SaldoPedido } from "../common/pedido-saldo";
import { horaMinutoSaoPaulo } from "../common/timezone";
import { podeAprovarProgramada, situacaoParaObra } from "./encarregado-regras";

/**
 * O que sai pro portal da obra, CAMPO A CAMPO.
 *
 * Whitelist e não "o objeto do Prisma menos uns campos": blacklist vaza o campo
 * que alguém criar amanhã. Aqui o encarregado nunca vê motorista (nome, CPF,
 * telefone), posição do caminhão, km, divergência, conferência — só o que a
 * obra reconhece: placa, hora, material, peso, ticket. R$ só com
 * `podeVerValores`, e a chave nem aparece no JSON sem ele.
 */

type Dec = Prisma.Decimal | null | undefined;

function dataIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function decTxt(v: Dec, casas: number): string | null {
  return v == null ? null : Number(v).toFixed(casas);
}

export function serializarPedidoObra(
  p: {
    numero: number;
    unidadeAlvo: UnidadePedido;
    prazoEm: Date | null;
    material: { nome: string } | null;
  },
  saldo: SaldoPedido,
  valores: { podeVerValores: boolean; valorEntregue?: Prisma.Decimal | null },
): PortalObraPedido {
  const base: PortalObraPedido = {
    numero: p.numero,
    material: p.material?.nome ?? null,
    unidade: p.unidadeAlvo,
    contratado: saldo.alvo,
    entregue: saldo.entregue,
    saldo: saldo.restante,
    percentual: saldo.percentual,
    viagens: saldo.viagens,
    prazoEm: p.prazoEm ? dataIso(p.prazoEm) : null,
    situacao: SITUACAO_PEDIDO_TEXTO[saldo.situacao],
  };
  if (valores.podeVerValores) base.valorEntregue = decTxt(valores.valorEntregue, 2) ?? "0.00";
  return base;
}

export function serializarProgramada(p: {
  id: string;
  dataPrevista: Date;
  janelaInicio: string | null;
  janelaFim: string | null;
  status: StatusViagemPlanejada;
  viagemId: string | null;
  aprovadaObraEm: Date | null;
  veiculo: { placa: string } | null;
  pedido: { numero: number; material: { nome: string } | null } | null;
}): PortalObraProgramada {
  return {
    id: p.id,
    data: dataIso(p.dataPrevista),
    janelaInicio: p.janelaInicio,
    janelaFim: p.janelaFim,
    status: p.status,
    situacao: situacaoParaObra(p.status),
    material: p.pedido?.material?.nome ?? null,
    placa: p.veiculo?.placa ?? null,
    pedidoNumero: p.pedido?.numero ?? null,
    aprovadaEm: p.aprovadaObraEm?.toISOString() ?? null,
    podeAprovar: podeAprovarProgramada(p),
  };
}

export function serializarTicket(
  v: {
    id: string;
    data: Date | null;
    criadoOfflineEm: Date | null;
    sincronizadoEm: Date;
    ticket: string | null;
    veiculo: { placa: string };
    material: { nome: string } | null;
    fotos: { id: string; rotacao: number }[];
    valor: { valorTotal: Prisma.Decimal } | null;
  },
  toneladasEfetivas: Prisma.Decimal | null,
  podeVerValores: boolean,
): PortalObraTicket {
  // Hora de quando o motorista registrou (no aparelho, se foi offline). É a
  // hora que a obra reconhece: "o das 10h20".
  const quando = v.criadoOfflineEm ?? v.sincronizadoEm;
  const t: PortalObraTicket = {
    id: v.id,
    data: v.data ? dataIso(v.data) : dataIso(quando),
    hora: horaMinutoSaoPaulo(quando),
    placa: v.veiculo.placa,
    material: v.material?.nome ?? null,
    ticket: v.ticket,
    toneladas: decTxt(toneladasEfetivas, 3),
    fotos: v.fotos.map((f) => ({ id: f.id, rotacao: f.rotacao })),
  };
  if (podeVerValores) t.valor = decTxt(v.valor?.valorTotal, 2);
  return t;
}

export function serializarSolicitacao(s: {
  id: string;
  data: Date;
  quantidade: Prisma.Decimal;
  unidade: UnidadePedido;
  material: { nome: string } | null;
  observacao: string | null;
  status: StatusSolicitacaoObra;
  recusaMotivo: string | null;
  viagensProgramadas: number | null;
  criadoEm: Date;
}): PortalObraSolicitacao {
  return {
    id: s.id,
    data: dataIso(s.data),
    quantidade: Number(s.quantidade).toFixed(s.unidade === "TONELADAS" ? 1 : 0),
    unidade: s.unidade,
    material: s.material?.nome ?? null,
    observacao: s.observacao,
    status: s.status,
    recusaMotivo: s.recusaMotivo,
    viagensProgramadas: s.viagensProgramadas,
    criadoEm: s.criadoEm.toISOString(),
  };
}
