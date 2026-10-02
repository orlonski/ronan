import type { StatusCobrancaCliente } from "@prisma/client";

/**
 * As regras puras da cobrança do cliente pelo Asaas — sem banco, sem HTTP, pra
 * caber num teste de unidade.
 *
 * O ponto delicado é a ORDEM dos eventos. O Asaas reenvia o que falhou e, num
 * reenvio, um PAYMENT_OVERDUE de ontem pode chegar depois do PAYMENT_RECEIVED
 * de hoje. Se cada evento simplesmente escrevesse "o status agora é X", um
 * webhook atrasado DESPAGARIA um título. Por isso a decisão olha o estado
 * atual e o evento juntos, e há uma única porta de saída do "pago": o estorno.
 */

export type AcaoEvento =
  /** O dinheiro entrou: nasce a baixa. */
  | "baixar"
  /** O dinheiro voltou: some a baixa que o gateway criou. */
  | "estornar"
  /** Só muda o status da cobrança; o título não mexe. */
  | "status"
  /** Mesmo status, dados novos (valor, vencimento, links). */
  | "atualizar"
  | "nada";

export type DecisaoEvento = {
  acao: AcaoEvento;
  /** O status novo da cobrança, quando muda. */
  novo?: StatusCobrancaCliente;
  /** Avisar o financeiro no sininho? */
  avisar?: "paga" | "vencida" | "estornada" | "contestacao" | "estorno-parcial";
  /** Por que não fez nada — vai pro registro do evento. */
  motivo?: string;
};

/** Eventos que dizem "o dinheiro entrou". CONFIRMED (cartão/boleto compensando) já conta. */
const EVENTOS_PAGO = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_DUNNING_RECEIVED"]);
/** Eventos que dizem "o dinheiro voltou". */
const EVENTOS_ESTORNO = new Set(["PAYMENT_REFUNDED", "PAYMENT_RECEIVED_IN_CASH_UNDONE"]);

/**
 * O que fazer com um evento, dado o status atual da cobrança.
 *
 * Regras, nesta ordem de importância:
 * 1. **Dinheiro que entrou é registrado** — mesmo numa cobrança que a gente já
 *    deu por cancelada (o cliente pagou o boleto antes de o cancelamento valer).
 *    Esconder recebimento é pior que qualquer inconsistência de status.
 * 2. **Estorno é definitivo.** Depois de ESTORNADA, nenhum "pago" atrasado
 *    repaga o título — o reenvio do RECEIVED de antes do estorno é exatamente o
 *    caso que essa regra existe pra barrar.
 * 3. **Nada além do estorno tira o "pago".** OVERDUE, DELETED, CREATED,
 *    UPDATED chegando depois do pagamento são ruído de ordem e são ignorados.
 */
export function decidirEvento(atual: StatusCobrancaCliente, evento: string): DecisaoEvento {
  if (EVENTOS_PAGO.has(evento)) {
    if (atual === "PAGA") return { acao: "nada", motivo: "já estava paga" };
    if (atual === "ESTORNADA") return { acao: "nada", motivo: "estornada é definitiva; pagamento atrasado ignorado" };
    return { acao: "baixar", novo: "PAGA", avisar: "paga" };
  }

  if (EVENTOS_ESTORNO.has(evento)) {
    if (atual === "ESTORNADA") return { acao: "nada", motivo: "já estava estornada" };
    if (atual === "PAGA") return { acao: "estornar", novo: "ESTORNADA", avisar: "estornada" };
    // Estorno chegando ANTES do pagamento (ordem trocada): marca como estornada
    // já, e a regra 2 impede o RECEIVED atrasado de pagar depois.
    if (atual === "PENDENTE" || atual === "VENCIDA") return { acao: "status", novo: "ESTORNADA", avisar: "estornada" };
    return { acao: "nada", motivo: `estorno numa cobrança ${atual.toLowerCase()}` };
  }

  switch (evento) {
    case "PAYMENT_OVERDUE":
      if (atual === "PENDENTE") return { acao: "status", novo: "VENCIDA", avisar: "vencida" };
      return { acao: "nada", motivo: `vencimento ignorado: cobrança ${atual.toLowerCase()}` };

    case "PAYMENT_DELETED":
      if (atual === "PENDENTE" || atual === "VENCIDA") return { acao: "status", novo: "CANCELADA" };
      return { acao: "nada", motivo: `exclusão ignorada: cobrança ${atual.toLowerCase()}` };

    case "PAYMENT_RESTORED":
      if (atual === "CANCELADA") return { acao: "status", novo: "PENDENTE" };
      return { acao: "nada", motivo: `restauração ignorada: cobrança ${atual.toLowerCase()}` };

    case "PAYMENT_CREATED":
    case "PAYMENT_UPDATED":
      if (atual === "PENDENTE" || atual === "VENCIDA") return { acao: "atualizar" };
      return { acao: "nada", motivo: `atualização ignorada: cobrança ${atual.toLowerCase()}` };

    // Contestação de cartão e estorno parcial não têm desfecho automático
    // seguro: o dinheiro pode ou não voltar. Fica como está e o financeiro é
    // avisado pra decidir.
    case "PAYMENT_CHARGEBACK_REQUESTED":
    case "PAYMENT_CHARGEBACK_DISPUTE":
      return { acao: "nada", avisar: atual === "PAGA" ? "contestacao" : undefined, motivo: "contestação: decisão humana" };
    case "PAYMENT_PARTIALLY_REFUNDED":
      return { acao: "nada", avisar: atual === "PAGA" ? "estorno-parcial" : undefined, motivo: "estorno parcial: decisão humana" };

    default:
      return { acao: "nada", motivo: "evento sem efeito na cobrança" };
  }
}

/**
 * O status de um pagamento lido direto no Asaas (botão "Atualizar situação")
 * como se fosse o evento que o teria levado até ali. Assim a conferência manual
 * passa pela MESMA `decidirEvento` do webhook — e herda as mesmas proteções.
 */
export function eventoDoStatusAsaas(status: string, apagado = false): string | null {
  if (apagado) return "PAYMENT_DELETED";
  switch (status) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
    case "DUNNING_RECEIVED":
      return "PAYMENT_RECEIVED";
    case "OVERDUE":
      return "PAYMENT_OVERDUE";
    case "REFUNDED":
      return "PAYMENT_REFUNDED";
    case "PENDING":
      return "PAYMENT_UPDATED";
    default:
      return null;
  }
}

/** A forma que o cliente escolheu, no vocabulário da `BaixaTitulo.meio`. */
export function meioDoBillingType(billingType: string | null | undefined): string {
  switch (billingType) {
    case "PIX":
      return "PIX";
    case "BOLETO":
      return "BOLETO";
    case "CREDIT_CARD":
    case "DEBIT_CARD":
      return "CARTAO";
    default:
      return "ASAAS";
  }
}

/**
 * CPF ou CNPJ do cliente, só dígitos — ou null se o cadastro não tem um que
 * sirva. O Asaas recusa cobrança sem documento, e descobrir isso pelo erro do
 * gateway ("cpfCnpj inválido") não diz à pessoa ONDE consertar.
 */
export function documentoDoCliente(cnpj: string | null | undefined): string | null {
  const d = (cnpj ?? "").replace(/\D/g, "");
  return d.length === 11 || d.length === 14 ? d : null;
}

/**
 * Vencimento que vai pro Asaas: o do título, ou hoje se ele já passou.
 *
 * O Asaas recusa criar cobrança com vencimento no passado. Título vencido que
 * só agora vai virar boleto é justamente o caso mais comum de "gerar boleto",
 * então a regra não pode ser recusar — é emitir pra hoje.
 */
export function vencimentoDaCobranca(vencimentoTitulo: string, hoje: string): string {
  return vencimentoTitulo < hoje ? hoje : vencimentoTitulo;
}

/** Dinheiro do Asaas (reais em float) → string com 2 casas, sem passar por soma em float. */
export function reaisDoAsaas(v: number | string | null | undefined): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return (Math.round(n * 100) / 100).toFixed(2);
}
