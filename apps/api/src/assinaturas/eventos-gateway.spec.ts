import { describe, expect, it } from "vitest";
import { extrairAutorizacao } from "./eventos-gateway.service";

/**
 * O evento de autorização de Pix Automático, como ele chega.
 *
 * Estes testes nasceram do primeiro pagamento real (14/09/2026): o dinheiro
 * entrou, o `PAYMENT_RECEIVED` chegou solto — sem `subscription` e sem
 * `externalReference`, porque o gateway registra o primeiro Pix como avulso —
 * e a assinatura ficou "aguardando autorização" para sempre. Quem conta que a
 * recorrência passou a valer é um evento de outra família, que nem estava
 * assinado no webhook.
 */
describe("extrair a autorização do evento", () => {
  it("acha sob a chave 'authorization'", () => {
    const evento = {
      id: "evt_1",
      event: "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED",
      authorization: { id: "pixaut_1", status: "ACTIVE", customerId: "cus_1" },
    };
    expect(extrairAutorizacao(evento)?.id).toBe("pixaut_1");
  });

  it("acha sob os outros nomes que o gateway pode usar", () => {
    // A doc descreve os campos da autorização mas não fixa a chave do envelope.
    // Três tentativas custam zero; errar custa uma assinatura que nunca ativa.
    for (const chave of [
      "pixAutomaticRecurringAuthorization",
      "pixAutomaticAuthorization",
      "recurringAuthorization",
    ]) {
      const evento = { id: "evt_1", event: "X", [chave]: { id: "pixaut_2" } };
      expect(extrairAutorizacao(evento)?.id, `chave ${chave}`).toBe("pixaut_2");
    }
  });

  it("nunca confunde o id do EVENTO com o da autorização", () => {
    // O `id` da raiz é "evt_...". Tomá-lo por autorização faria o sistema
    // procurar uma assinatura que não existe — e, pior, poderia casar com a
    // errada se um dia os formatos se parecerem.
    const evento = { id: "evt_d26e303b238e509335ac9ba210e51b0f", event: "ALGUMA_COISA" };
    expect(extrairAutorizacao(evento)).toBeNull();
  });

  it("evento de pagamento não é evento de autorização", () => {
    const evento = { id: "abc", event: "PAYMENT_RECEIVED", payment: { id: "pay_1" } };
    expect(extrairAutorizacao(evento)).toBeNull();
  });

  it("payload vazio ou estranho devolve null em vez de explodir", () => {
    expect(extrairAutorizacao(undefined)).toBeNull();
    expect(extrairAutorizacao(null)).toBeNull();
    expect(extrairAutorizacao({ authorization: "não é objeto" })).toBeNull();
    expect(extrairAutorizacao({ authorization: { semId: true } })).toBeNull();
  });
});
