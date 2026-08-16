import { StatusViagem } from "@prisma/client";

/**
 * Status de viagem que representam uma viagem INCOMPLETA e que NUNCA podem
 * entrar em match/fechamento/KPIs/resumos/export:
 *
 * - EM_ANDAMENTO: lifecycle guiado ainda aberto (campos podem estar nulos).
 * - AGUARDANDO_PESO: lançada sem peso/ticket (romaneio no fim do dia).
 * - AGUARDANDO_SAIDA: diária aberta — entrada marcada, saída ainda não.
 * - INCOMPLETA: entrou faltando dado essencial (km/material/local/peso) ou
 *   apontando pra cadastro que sumiu. O servidor aceitou de propósito, em vez
 *   de recusar e matar o lançamento no celular do motorista — o que falta está
 *   carimbado em `ViagemDivergencia` pra quem confere resolver.
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
  StatusViagem.AGUARDANDO_SAIDA,
  StatusViagem.INCOMPLETA,
];
