import { StatusViagem } from "@prisma/client";

/**
 * Status de viagem que representam uma viagem INCOMPLETA e que NUNCA podem
 * entrar em match/fechamento/KPIs/resumos/export:
 *
 * - EM_ANDAMENTO: lifecycle guiado ainda aberto (campos podem estar nulos).
 * - AGUARDANDO_PESO: lançada sem peso/ticket (romaneio no fim do dia).
 *
 * Use este array em todo filtro que antes excluía só EM_ANDAMENTO:
 *   where: { status: { notIn: STATUS_FORA_FECHAMENTO } }
 *
 * ⚠️ Esquecer um ponto de exclusão faz uma viagem sem peso entrar como 0t no
 * fechamento/KPI. Centralizar aqui evita isso.
 */
export const STATUS_FORA_FECHAMENTO: StatusViagem[] = [
  StatusViagem.EM_ANDAMENTO,
  StatusViagem.AGUARDANDO_PESO,
];
