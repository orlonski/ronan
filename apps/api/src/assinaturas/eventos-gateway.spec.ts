import { describe, expect, it } from "vitest";
import { EventosGatewayService, extrairAutorizacao } from "./eventos-gateway.service";

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

// ---------------------------------------------------------------------------
// O pagamento de ativação.
//
// Testes com dublê de Prisma, porque o que importa aqui é a DECISÃO: registrar
// a mensalidade quando a autorização ativa, e — o mais importante — NÃO mexer
// no que já existe. Uma competência sobrescrita é uma cobrança paga virando
// outra coisa, e isso é dinheiro.
// ---------------------------------------------------------------------------

type CobrancaFalsa = {
  assinaturaId: string;
  competencia: Date;
  status: string;
  valorCentavos: number;
  valorPagoCentavos?: number | null;
  pagamentoDeAtivacao?: boolean;
  formaPaga?: string | null;
};

function servico(opcoes: {
  assinatura?: { id: string; contaId: string; valorCentavos: number; status: string; inicioEm: Date | null } | null;
  cobrancaExistente?: CobrancaFalsa | null;
}) {
  const criadas: CobrancaFalsa[] = [];
  const vistos = new Set<string>();
  const atualizadasAssinatura: Record<string, unknown>[] = [];
  const assinatura = opcoes.assinatura === undefined
    ? { id: "a1", contaId: "c1", valorCentavos: 189000, status: "AGUARDANDO", inicioEm: null }
    : opcoes.assinatura;

  const prisma = {
    assinatura: {
      findFirst: async () => assinatura,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        atualizadasAssinatura.push(data);
        return assinatura;
      },
    },
    cobrancaAssinatura: {
      findUnique: async () => opcoes.cobrancaExistente ?? null,
      create: async ({ data }: { data: CobrancaFalsa }) => {
        criadas.push(data);
        return data;
      },
    },
    // Guarda os eventos vistos pra reproduzir a trava de idempotência que no
    // banco é o unique de `eventoId`. Sem isto o dublê aceitaria reenvio, e o
    // teste passaria a medir o dublê em vez do serviço.
    eventoGatewayPagamento: {
      findUnique: async ({ where }: { where: { eventoId: string } }) =>
        vistos.has(where.eventoId) ? { id: "evt-linha", processadoEm: new Date() } : null,
      create: async ({ data }: { data: { eventoId: string } }) => {
        vistos.add(data.eventoId);
        return { id: "evt-linha" };
      },
      update: async () => ({}),
    },
  };
  const assinaturas = { reavaliarInadimplencia: async () => {} };
  const s = new EventosGatewayService(prisma as never, assinaturas as never);
  return { s, criadas, atualizadasAssinatura };
}

const EVENTO_ATIVADO = {
  id: "evt_ativou_1",
  event: "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED",
  authorization: { id: "pixaut_1", status: "ACTIVE" },
};

describe("o pagamento que ativa a recorrência vira mensalidade paga", () => {
  it("registra a competência atual como RECEBIDA, no valor da assinatura", async () => {
    // Sem isto, o cliente paga a primeira mensalidade e ela não existe em lugar
    // nenhum: some da receita e ele fica sem resposta ao perguntar.
    const { s, criadas } = servico({});
    const r = await s.receber("evt_ativou_1", EVENTO_ATIVADO.event, EVENTO_ATIVADO);

    expect(r.status).toBe("processado");
    expect(criadas).toHaveLength(1);
    expect(criadas[0]!.status).toBe("RECEBIDA");
    expect(criadas[0]!.valorCentavos).toBe(189000);
    expect(criadas[0]!.valorPagoCentavos).toBe(189000);
    expect(criadas[0]!.pagamentoDeAtivacao).toBe(true);
    expect(criadas[0]!.formaPaga).toBe("PIX");
  });

  it("a assinatura vira ATIVA junto", async () => {
    const { s, atualizadasAssinatura } = servico({});
    await s.receber("evt_ativou_1", EVENTO_ATIVADO.event, EVENTO_ATIVADO);
    expect(atualizadasAssinatura[0]!.status).toBe("ATIVA");
  });

  it("NÃO toca numa cobrança que já existe naquele mês", async () => {
    // O que veio do gateway, com id e valor de verdade, vale mais que o que a
    // gente deduz. Sobrescrever seria transformar um pagamento real em palpite.
    const { s, criadas } = servico({
      cobrancaExistente: {
        assinaturaId: "a1",
        competencia: new Date(),
        status: "RECEBIDA",
        valorCentavos: 189000,
      },
    });
    await s.receber("evt_ativou_1", EVENTO_ATIVADO.event, EVENTO_ATIVADO);
    expect(criadas).toHaveLength(0);
  });

  it("reenvio do mesmo evento não cria uma segunda mensalidade", async () => {
    const { s, criadas } = servico({});
    await s.receber("evt_ativou_1", EVENTO_ATIVADO.event, EVENTO_ATIVADO);
    // O segundo passa pela trava de idempotência (mesmo eventoId) antes de
    // chegar perto de criar qualquer coisa.
    const r2 = await s.receber("evt_ativou_1", EVENTO_ATIVADO.event, EVENTO_ATIVADO);
    expect(r2.status).toBe("duplicado");
    expect(criadas).toHaveLength(1);
  });

  it("assinatura já cancelada não recebe cobrança nenhuma", async () => {
    const { s, criadas } = servico({
      assinatura: { id: "a1", contaId: "c1", valorCentavos: 189000, status: "CANCELADA", inicioEm: null },
    });
    const r = await s.receber("evt_ativou_1", EVENTO_ATIVADO.event, EVENTO_ATIVADO);
    expect(r.status).toBe("ignorado");
    expect(criadas).toHaveLength(0);
  });

  it("autorização de assinatura que não é nossa não cria nada", async () => {
    const { s, criadas } = servico({ assinatura: null });
    const r = await s.receber("evt_ativou_1", EVENTO_ATIVADO.event, EVENTO_ATIVADO);
    expect(r.status).toBe("ignorado");
    expect(criadas).toHaveLength(0);
  });
});
