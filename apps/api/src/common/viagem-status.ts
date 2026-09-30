import { StatusViagem } from "@prisma/client";

/**
 * Status de viagem que representam uma viagem INCOMPLETA e que NUNCA podem
 * entrar em match/fechamento/KPIs/resumos/export:
 *
 * - EM_ANDAMENTO: lifecycle guiado ainda aberto (campos podem estar nulos).
 * - AGUARDANDO_PESO: lançada sem peso/ticket (romaneio no fim do dia).
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
  StatusViagem.INCOMPLETA,
];

/**
 * O que está na mesa de quem confere: viagem que ninguém revisou e que depende
 * de gente (ou do robô) decidir — Aguardando, Ajustada (o motorista respondeu)
 * e Em conferência (o robô ficou em dúvida).
 *
 * Fica de fora a DIVERGENTE que o robô marcou: ela tem `revisadoEm` null, mas
 * está esperando o MOTORISTA corrigir, não a equipe. Contá-la como pendente
 * inflava o card do painel e o clique abria uma lista que não tinha ela.
 *
 * Usar sempre junto de `revisadoEm: null`. É a mesma régua do card "Pendentes"
 * do painel e do filtro "Pendentes" da lista de viagens — divergir é o card
 * dizer 48 e a lista mostrar 2.
 */
export const STATUS_PENDENTE_CONFERENCIA: StatusViagem[] = [
  StatusViagem.ENVIADA,
  StatusViagem.AJUSTADA,
  StatusViagem.EM_CONFERENCIA,
];
