import { describe, expect, it } from "vitest";
import { AssinaturasService } from "./assinaturas.service";

/**
 * Rascunho parado não pode trancar a empresa.
 *
 * Nasceu de um caso real: "Nova assinatura" devolvia "Movatruck já tem uma
 * assinatura em andamento. Cancele a atual antes de criar outra" numa empresa
 * cuja assinatura JÁ tinha sido cancelada. O que sobrara era um rascunho — a
 * linha que gravamos antes de chamar o gateway, e que fica pra trás quando ele
 * recusa. Ninguém estava sendo cobrado por ela, e mesmo assim não havia como
 * criar a assinatura daquela empresa.
 *
 * Se isto quebrar, o cliente fechado não consegue começar a pagar.
 */
describe("criar convive com rascunho parado", () => {
  function servico(existente: Record<string, unknown> | null) {
    const escritas: { tipo: "create" | "update"; id?: string; data: Record<string, unknown> }[] = [];
    const base = {
      id: "a1",
      contaId: "c1",
      forma: "PIX_AUTOMATICO",
      ciclo: "MENSAL",
      valorCentavos: 189000,
      diaVencimento: 10,
      nomeResponsavel: "Financeiro",
      emailCobranca: "f@x.com",
      telefoneCobranca: "5542998424945",
      documento: "12345678000199",
      documentoFinal: "0199",
      cartaoBandeira: null,
      cartaoUltimos4: null,
      qrCodePayload: null,
      qrCodeExpiraEm: null,
      inicioEm: null,
      proximoVencimento: null,
      canceladaEm: null,
      motivoCancelamento: null,
      observacao: null,
      criadoEm: new Date(),
      gatewayAutorizacaoId: null,
      gatewayAssinaturaId: null,
      gatewayClienteId: null,
    };
    const prisma = {
      conta: { findFirst: async () => ({ id: "c1", nome: "Movatruck" }) },
      assinatura: {
        findFirst: async () => existente,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          escritas.push({ tipo: "create", data });
          return { ...base, ...data };
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          escritas.push({ tipo: "update", id: where.id, data });
          return { ...base, ...data };
        },
      },
    };
    const gateway = {
      // Desligado de propósito: o teste para no rascunho, que é onde mora a
      // regra. O que o gateway faz depois tem spec próprio.
      configurado: () => false,
    };
    const s = new AssinaturasService(
      prisma as never,
      gateway as never,
      { precoPara: async () => null } as never,
      { log: async () => {} } as never,
      { avisarAgora: async () => ({ enviado: true }) } as never,
    );
    return { s, escritas };
  }

  const entrada = {
    contaId: "c1",
    forma: "PIX_AUTOMATICO",
    ciclo: "MENSAL",
    valorCentavos: 189000,
    diaVencimento: 10,
    nomeResponsavel: "Financeiro",
    emailCobranca: "f@x.com",
    telefoneCobranca: "5542998424945",
    documento: "12345678000199",
  } as never;

  it("retoma o rascunho em vez de bloquear", async () => {
    const { s, escritas } = servico({ id: "rascunho-1", contaId: "c1", status: "RASCUNHO" });

    // O gateway está desligado, então o fim da linha é esse erro — e não o 409
    // de "já tem uma assinatura em andamento", que era o bug.
    await expect(s.criar(entrada, "u1")).rejects.toThrow(/gateway de pagamento não está configurado/i);

    expect(escritas).toHaveLength(1);
    expect(escritas[0].tipo).toBe("update");
    expect(escritas[0].id).toBe("rascunho-1");
  });

  it("o rascunho retomado recebe os dados novos", async () => {
    const { s, escritas } = servico({ id: "rascunho-1", contaId: "c1", status: "RASCUNHO" });

    await expect(
      s.criar({ ...(entrada as object), valorCentavos: 250000 } as never, "u1"),
    ).rejects.toThrow();

    expect(escritas[0].data.valorCentavos).toBe(250000);
    expect(escritas[0].data.status).toBe("RASCUNHO");
  });

  it("assinatura que cobra de verdade continua bloqueando", async () => {
    const { s, escritas } = servico({ id: "a1", contaId: "c1", status: "ATIVA" });

    await expect(s.criar(entrada, "u1")).rejects.toThrow(/Movatruck já tem uma assinatura ativa/i);
    expect(escritas).toHaveLength(0);
  });

  it("aguardando autorização também bloqueia", async () => {
    const { s } = servico({ id: "a1", contaId: "c1", status: "AGUARDANDO" });

    await expect(s.criar(entrada, "u1")).rejects.toThrow(/aguardando autorização/i);
  });

  it("empresa sem nada cria linha nova", async () => {
    const { s, escritas } = servico(null);

    await expect(s.criar(entrada, "u1")).rejects.toThrow();

    expect(escritas[0].tipo).toBe("create");
    expect(escritas[0].data.contaId).toBe("c1");
    expect(escritas[0].data.criadoPorId).toBe("u1");
  });
});
