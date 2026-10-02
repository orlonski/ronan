import { describe, expect, it } from "vitest";
import type { StatusCobrancaCliente } from "@prisma/client";
import { detectarAmbienteAsaas } from "@ronan/shared-types";
import {
  decidirEvento,
  documentoDoCliente,
  eventoDoStatusAsaas,
  meioDoBillingType,
  reaisDoAsaas,
  vencimentoDaCobranca,
} from "./cobranca-cliente.regras";

/**
 * Simula a sequência de eventos como o service aplica: status da cobrança e
 * quantas baixas o título tem. É o jeito de provar idempotência e ordem
 * trocada sem banco — o service só executa o que `decidirEvento` manda.
 */
function rodar(eventos: string[], inicio: StatusCobrancaCliente = "PENDENTE") {
  let status = inicio;
  let baixas = 0;
  for (const e of eventos) {
    const d = decidirEvento(status, e);
    if (d.acao === "baixar") baixas = Math.min(1, baixas + 1); // BaixaTitulo.cobrancaClienteId é @unique
    if (d.acao === "estornar") baixas = 0;
    if (d.novo && d.acao !== "nada") status = d.novo;
  }
  return { status, pago: baixas === 1 };
}

describe("evento do Asaas → situação da cobrança e do título", () => {
  it("PAYMENT_RECEIVED paga e baixa", () => {
    expect(decidirEvento("PENDENTE", "PAYMENT_RECEIVED")).toMatchObject({ acao: "baixar", novo: "PAGA", avisar: "paga" });
    expect(rodar(["PAYMENT_RECEIVED"])).toEqual({ status: "PAGA", pago: true });
  });

  it("PAYMENT_CONFIRMED também paga (cartão/compensação)", () => {
    expect(rodar(["PAYMENT_CONFIRMED"])).toEqual({ status: "PAGA", pago: true });
  });

  it("vencida que depois é paga vira paga", () => {
    expect(rodar(["PAYMENT_OVERDUE", "PAYMENT_RECEIVED"])).toEqual({ status: "PAGA", pago: true });
  });

  it("PAYMENT_OVERDUE só marca vencida — o título não mexe", () => {
    expect(decidirEvento("PENDENTE", "PAYMENT_OVERDUE")).toMatchObject({ acao: "status", novo: "VENCIDA" });
    expect(rodar(["PAYMENT_OVERDUE"])).toEqual({ status: "VENCIDA", pago: false });
  });

  it("estorno desfaz a baixa e devolve o título", () => {
    expect(rodar(["PAYMENT_RECEIVED", "PAYMENT_REFUNDED"])).toEqual({ status: "ESTORNADA", pago: false });
    expect(rodar(["PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH_UNDONE"])).toEqual({ status: "ESTORNADA", pago: false });
  });

  it("excluída no Asaas vira cancelada; paga não é excluída", () => {
    expect(rodar(["PAYMENT_DELETED"])).toEqual({ status: "CANCELADA", pago: false });
    expect(rodar(["PAYMENT_RECEIVED", "PAYMENT_DELETED"])).toEqual({ status: "PAGA", pago: true });
  });

  it("restaurada volta a pendente", () => {
    expect(rodar(["PAYMENT_DELETED", "PAYMENT_RESTORED"])).toEqual({ status: "PENDENTE", pago: false });
  });
});

describe("idempotência", () => {
  it("o mesmo pagamento chegando duas vezes baixa uma vez só", () => {
    expect(decidirEvento("PAGA", "PAYMENT_RECEIVED").acao).toBe("nada");
    expect(rodar(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED"])).toEqual({ status: "PAGA", pago: true });
  });

  it("estorno repetido não faz nada", () => {
    expect(decidirEvento("ESTORNADA", "PAYMENT_REFUNDED").acao).toBe("nada");
  });

  it("vencimento repetido não faz nada", () => {
    expect(decidirEvento("VENCIDA", "PAYMENT_OVERDUE").acao).toBe("nada");
  });
});

describe("ordem trocada nunca despaga", () => {
  it("OVERDUE atrasado depois do pagamento é ignorado", () => {
    expect(rodar(["PAYMENT_RECEIVED", "PAYMENT_OVERDUE"])).toEqual({ status: "PAGA", pago: true });
  });

  it("CREATED/UPDATED atrasados depois do pagamento são ignorados", () => {
    expect(rodar(["PAYMENT_RECEIVED", "PAYMENT_CREATED", "PAYMENT_UPDATED"])).toEqual({ status: "PAGA", pago: true });
  });

  it("estorno é definitivo: o RECEIVED reenviado depois do estorno não repaga", () => {
    expect(rodar(["PAYMENT_RECEIVED", "PAYMENT_REFUNDED", "PAYMENT_RECEIVED"])).toEqual({ status: "ESTORNADA", pago: false });
  });

  it("estorno chegando ANTES do pagamento: o pagamento atrasado não paga", () => {
    expect(rodar(["PAYMENT_REFUNDED", "PAYMENT_RECEIVED"])).toEqual({ status: "ESTORNADA", pago: false });
  });

  it("dinheiro que entrou numa cobrança já cancelada é registrado", () => {
    expect(rodar(["PAYMENT_RECEIVED"], "CANCELADA")).toEqual({ status: "PAGA", pago: true });
  });

  it("restauração atrasada não reabre cobrança paga", () => {
    expect(rodar(["PAYMENT_RECEIVED", "PAYMENT_RESTORED"])).toEqual({ status: "PAGA", pago: true });
  });
});

describe("contestação e estorno parcial ficam com uma pessoa", () => {
  it("não mexem na baixa, mas avisam", () => {
    expect(decidirEvento("PAGA", "PAYMENT_CHARGEBACK_REQUESTED")).toMatchObject({ acao: "nada", avisar: "contestacao" });
    expect(decidirEvento("PAGA", "PAYMENT_PARTIALLY_REFUNDED")).toMatchObject({ acao: "nada", avisar: "estorno-parcial" });
  });
});

describe("conferência manual usa a mesma régua", () => {
  it("status do Asaas vira o evento equivalente", () => {
    expect(eventoDoStatusAsaas("RECEIVED")).toBe("PAYMENT_RECEIVED");
    expect(eventoDoStatusAsaas("CONFIRMED")).toBe("PAYMENT_RECEIVED");
    expect(eventoDoStatusAsaas("RECEIVED_IN_CASH")).toBe("PAYMENT_RECEIVED");
    expect(eventoDoStatusAsaas("OVERDUE")).toBe("PAYMENT_OVERDUE");
    expect(eventoDoStatusAsaas("REFUNDED")).toBe("PAYMENT_REFUNDED");
    expect(eventoDoStatusAsaas("PENDING", true)).toBe("PAYMENT_DELETED");
    expect(eventoDoStatusAsaas("AWAITING_RISK_ANALYSIS")).toBeNull();
  });
});

describe("bordas", () => {
  it("meio da baixa pelo que o cliente escolheu", () => {
    expect(meioDoBillingType("PIX")).toBe("PIX");
    expect(meioDoBillingType("BOLETO")).toBe("BOLETO");
    expect(meioDoBillingType("CREDIT_CARD")).toBe("CARTAO");
    expect(meioDoBillingType("UNDEFINED")).toBe("ASAAS");
  });

  it("documento: só CPF (11) ou CNPJ (14), com ou sem máscara", () => {
    expect(documentoDoCliente("12.345.678/0001-90")).toBe("12345678000190");
    expect(documentoDoCliente("123.456.789-09")).toBe("12345678909");
    expect(documentoDoCliente("123")).toBeNull();
    expect(documentoDoCliente(null)).toBeNull();
  });

  it("título vencido vira boleto pra hoje — o Asaas recusa vencimento no passado", () => {
    expect(vencimentoDaCobranca("2026-09-01", "2026-10-02")).toBe("2026-10-02");
    expect(vencimentoDaCobranca("2026-11-10", "2026-10-02")).toBe("2026-11-10");
  });

  it("reais do Asaas sem erro de ponto flutuante", () => {
    expect(reaisDoAsaas(189.9)).toBe("189.90");
    expect(reaisDoAsaas(0.1 + 0.2)).toBe("0.30");
    expect(reaisDoAsaas(undefined)).toBeNull();
  });

  it("ambiente pelo prefixo da chave", () => {
    expect(detectarAmbienteAsaas("$aact_prod_abc")).toBe("PRODUCAO");
    expect(detectarAmbienteAsaas("$aact_hmlg_abc")).toBe("SANDBOX");
    expect(detectarAmbienteAsaas("$aact_YTU5YTE0M2M2")).toBeNull();
  });
});
