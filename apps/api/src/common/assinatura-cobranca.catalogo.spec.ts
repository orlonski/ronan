import { describe, expect, it } from "vitest";
import { statusDoGateway } from "./assinatura-cobranca";

/**
 * O catálogo INTEIRO do gateway, decidido um por um.
 *
 * Nasceu de uma pergunta do dono — "eu quero garantir que meu sistema
 * funciona" — e da constatação de que a gente só testava os status que já
 * tinham aparecido na prática. O que nunca apareceu era justamente o que
 * ninguém tinha decidido: caía no `default`, virava "ignorado", e a diferença
 * entre "decidi ignorar" e "não pensei nisso" não existia em lugar nenhum.
 *
 * Aqui ela existe. Cada status que o Asaas documenta aparece nesta tabela com
 * o que deve acontecer, e um status novo (ou uma mudança no mapeamento) quebra
 * o build em vez de virar surpresa no extrato.
 *
 * Fonte: docs.asaas.com/docs/webhook-para-cobrancas e /docs/status-possíveis,
 * conferidos em 14/09/2026.
 */
describe("todo status do gateway tem destino decidido", () => {
  /**
   * `null` aqui não é buraco: é "ignorar de propósito". Ignorar nunca inventa
   * pagamento nem rebaixa cobrança — é o único default seguro quando o gateway
   * fala algo que a gente não modelou.
   */
  const CATALOGO: { status: string; esperado: string | null; porque: string }[] = [
    // --- o caminho feliz ---
    { status: "PENDING", esperado: "PENDENTE", porque: "nasceu, ninguém pagou ainda" },
    { status: "CONFIRMED", esperado: "CONFIRMADA", porque: "pagou; o saldo ainda não caiu" },
    { status: "RECEIVED", esperado: "RECEBIDA", porque: "o dinheiro está na conta" },
    { status: "RECEIVED_IN_CASH", esperado: "RECEBIDA", porque: "baixa em dinheiro dada no Asaas" },
    { status: "OVERDUE", esperado: "VENCIDA", porque: "passou do vencimento — é o que liga a régua" },

    // --- o dinheiro voltou ---
    { status: "REFUNDED", esperado: "ESTORNADA", porque: "estorno concluído" },
    { status: "PARTIALLY_REFUNDED", esperado: "ESTORNADA", porque: "voltou parte; não é mais receita cheia" },
    {
      status: "CHARGEBACK_REQUESTED",
      esperado: "ESTORNADA",
      porque: "o cliente contestou no cartão: o dinheiro SAIU da conta",
    },
    { status: "CHARGEBACK_DISPUTE", esperado: "ESTORNADA", porque: "em disputa — o dinheiro segue fora" },
    {
      status: "AWAITING_CHARGEBACK_REVERSAL",
      esperado: "PENDENTE",
      porque: "ganhamos a disputa e o valor ainda vai voltar",
    },

    // --- risco e cancelamento ---
    { status: "AWAITING_RISK_ANALYSIS", esperado: "PENDENTE", porque: "o cartão está em análise" },
    { status: "DELETED", esperado: "CANCELADA", porque: "a cobrança foi apagada no gateway" },

    // --- decididamente ignorados ---
    // Todos são estados de PASSAGEM: o gateway manda o definitivo logo depois
    // (REFUNDED, ou a volta pra PENDING/OVERDUE), e é esse que vale. Reagir ao
    // intermediário só antecipa uma conclusão que pode não se confirmar.
    { status: "REFUND_REQUESTED", esperado: null, porque: "estorno pedido, ainda não aconteceu" },
    { status: "REFUND_IN_PROGRESS", esperado: null, porque: "estorno agendado; o REFUNDED é que conclui" },
    { status: "REFUND_DENIED", esperado: null, porque: "estorno negado: a cobrança não mudou de estado" },
    // Negativação Serasa: a Movatruck não usa, e não vai usar contra as
    // próprias clientes. Se um dia usar, DUNNING_RECEIVED é dinheiro entrando
    // e PRECISA virar RECEBIDA — por isso está escrito aqui, e não esquecido.
    { status: "DUNNING_REQUESTED", esperado: null, porque: "negativação pedida; não usamos" },
    { status: "DUNNING_RECEIVED", esperado: null, porque: "negativação paga; não usamos — ver comentário" },
  ];

  for (const { status, esperado, porque } of CATALOGO) {
    it(`${status} → ${esperado ?? "ignorado"} (${porque})`, () => {
      expect(statusDoGateway(status)).toBe(esperado);
    });
  }

  it("status que o Asaas inventar amanhã é ignorado, nunca chutado", () => {
    // Chutar PENDENTE faria uma cobrança paga voltar pra régua, e o cliente
    // seria cobrado de novo por um mês que ele já pagou.
    expect(statusDoGateway("ALGO_NOVO_DO_ASAAS")).toBeNull();
    expect(statusDoGateway("")).toBeNull();
  });

  it("o catálogo cobre todos os status documentados pelo gateway", () => {
    // Se o Asaas publicar um status novo, esta lista é o lugar de decidi-lo.
    // O teste existe pra que a decisão seja consciente: ninguém "esquece" de
    // mexer numa lista que quebra o build.
    const DOCUMENTADOS = [
      "PENDING",
      "CONFIRMED",
      "RECEIVED",
      "RECEIVED_IN_CASH",
      "OVERDUE",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "REFUND_REQUESTED",
      "REFUND_IN_PROGRESS",
      "REFUND_DENIED",
      "CHARGEBACK_REQUESTED",
      "CHARGEBACK_DISPUTE",
      "AWAITING_CHARGEBACK_REVERSAL",
      "AWAITING_RISK_ANALYSIS",
      "DUNNING_REQUESTED",
      "DUNNING_RECEIVED",
      "DELETED",
    ];
    const cobertos = CATALOGO.map((c) => c.status);
    expect([...DOCUMENTADOS].sort()).toEqual([...cobertos].sort());
  });
});
