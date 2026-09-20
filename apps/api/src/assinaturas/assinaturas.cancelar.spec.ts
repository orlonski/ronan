import { describe, expect, it } from "vitest";
import { AssinaturasService } from "./assinaturas.service";

/**
 * Cancelar tem que chegar ao gateway — e apagar tudo que ainda cobraria.
 *
 * Este teste nasceu de uma pergunta do dono — "quando eu cancelo pela tela,
 * reflete no Asaas?" — e da resposta, que era "só em parte". No cartão o
 * `DELETE /subscriptions` levava junto as cobranças pendentes e não sobrava
 * nada. No Pix Automático não: o cancelamento matava a AUTORIZAÇÃO e deixava
 * viva a assinatura que o gateway cria por baixo dela, com a cobrança do mês
 * seguinte já aberta. Em 14/09/2026 duas assinaturas canceladas estavam assim,
 * cada uma com R$ 5,00 em aberto pra 10/10 no nome do cliente.
 *
 * Se isto quebrar, o efeito é o pior possível: a tela diz "cancelada", o
 * cliente acha que parou de pagar, e chega uma cobrança mesmo assim.
 */
describe("cancelar apaga tudo no gateway", () => {
  function servico(over: Record<string, unknown> = {}, cobrancas: unknown[] = []) {
    const assinaturas: { id: string; forma: string }[] = [];
    const cobrancasApagadas: string[] = [];
    const assinatura = {
      id: "a1",
      contaId: "c1",
      status: "ATIVA",
      forma: "PIX_AUTOMATICO",
      valorCentavos: 189000,
      ciclo: "MENSAL",
      diaVencimento: 10,
      nomeResponsavel: "Financeiro",
      emailCobranca: "f@x.com",
      telefoneCobranca: "5542998424945",
      documento: "12345678000199",
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
      gatewayAutorizacaoId: "pixaut_1",
      gatewayAssinaturaId: null,
      ...over,
    };
    let filtroDasCobrancas: unknown = null;
    const prisma = {
      assinatura: {
        findFirst: async () => assinatura,
        update: async () => ({ ...assinatura, status: "CANCELADA" }),
      },
      cobrancaAssinatura: {
        updateMany: async () => ({ count: 0 }),
        findMany: async (args: { where: unknown }) => {
          filtroDasCobrancas = args.where;
          return cobrancas;
        },
      },
    };
    const gateway = {
      configurado: () => true,
      cancelarAssinatura: async (id: string, forma: string) => {
        assinaturas.push({ id, forma });
      },
      cancelarCobranca: async (id: string) => {
        cobrancasApagadas.push(id);
      },
    };
    const s = new AssinaturasService(
      prisma as never,
      gateway as never,
      { precoPara: async () => null } as never,
      { log: async () => {} } as never,
      { avisarAgora: async () => ({ enviado: true }) } as never,
      { garantirLink: async () => "https://app.movatruck.com.br/pagar/tok", urlDoToken: (t: string) => `https://app.movatruck.com.br/pagar/${t}` } as never,
    );
    return { s, assinaturas, cobrancasApagadas, filtro: () => filtroDasCobrancas };
  }

  it("Pix Automático: cancela a AUTORIZAÇÃO lá fora", async () => {
    const { s, assinaturas } = servico();
    await s.cancelar("a1", "teste de cancelamento", "u1");
    expect(assinaturas).toEqual([{ id: "pixaut_1", forma: "PIX_AUTOMATICO" }]);
  });

  it("Pix Automático: apaga TAMBÉM a assinatura que o gateway criou por baixo", async () => {
    const { s, assinaturas } = servico({ gatewayAssinaturaId: "sub_9" });
    await s.cancelar("a1", "teste de cancelamento", "u1");
    // A autorização primeiro, a assinatura depois. Matar só a primeira era o
    // bug: a segunda seguia marcando "próxima cobrança" todo mês.
    expect(assinaturas).toEqual([
      { id: "pixaut_1", forma: "PIX_AUTOMATICO" },
      { id: "sub_9", forma: "PIX" },
    ]);
  });

  it("cartão: cancela a ASSINATURA lá fora", async () => {
    const { s, assinaturas } = servico({
      forma: "CARTAO",
      gatewayAutorizacaoId: null,
      gatewayAssinaturaId: "sub_1",
    });
    await s.cancelar("a1", "teste de cancelamento", "u1");
    expect(assinaturas).toEqual([{ id: "sub_1", forma: "PIX" }]);
  });

  it("apaga as cobranças que sobraram abertas no gateway", async () => {
    const { s, cobrancasApagadas } = servico({}, [
      { id: "c1", gatewayCobrancaId: "pay_outubro" },
      { id: "c2", gatewayCobrancaId: "pay_novembro" },
    ]);
    await s.cancelar("a1", "teste de cancelamento", "u1");
    expect(cobrancasApagadas).toEqual(["pay_outubro", "pay_novembro"]);
  });

  it("nunca tenta apagar cobrança já paga", async () => {
    const { s, filtro } = servico();
    await s.cancelar("a1", "teste de cancelamento", "u1");
    expect(filtro()).toMatchObject({
      status: { notIn: ["CONFIRMADA", "RECEBIDA"] },
      gatewayCobrancaId: { not: null },
    });
  });

  it("já cancelada aqui ainda assim limpa o gateway", async () => {
    // O caso real: o cliente cancelou a autorização no app do banco, o webhook
    // marcou CANCELADA deste lado, e o painel não tinha mais como alcançar o
    // que continuava vivo lá. Sair cedo demais era o que deixava a sujeira.
    const { s, assinaturas, cobrancasApagadas } = servico(
      { status: "CANCELADA", gatewayAssinaturaId: "sub_9" },
      [{ id: "c1", gatewayCobrancaId: "pay_outubro" }],
    );
    await s.cancelar("a1", "limpeza", "u1");
    expect(assinaturas).toEqual([
      { id: "pixaut_1", forma: "PIX_AUTOMATICO" },
      { id: "sub_9", forma: "PIX" },
    ]);
    expect(cobrancasApagadas).toEqual(["pay_outubro"]);
  });

  it("rascunho que nunca chegou ao gateway não tenta cancelar nada", async () => {
    const { s, assinaturas, cobrancasApagadas } = servico({
      status: "RASCUNHO",
      gatewayAutorizacaoId: null,
      gatewayAssinaturaId: null,
    });
    await s.cancelar("a1", "nunca foi pro gateway", "u1");
    expect(assinaturas).toHaveLength(0);
    expect(cobrancasApagadas).toHaveLength(0);
  });
});
