import { describe, expect, it } from "vitest";
import { PagamentoLinkService } from "./pagamento-link.service";

/**
 * A página pública de pagamento — o que ela mostra e o que ela NUNCA mostra.
 *
 * Ela existe porque o copia-e-cola do Pix não cabe em mensagem: são ~230
 * caracteres, e no WhatsApp o toque longo copia o balão inteiro, com a
 * saudação junto — que o banco recusa sem dizer por quê. Botão nativo de
 * copiar não resolve (o `COPY_CODE` da Meta para em 15 caracteres), então
 * copiar de verdade só acontece numa página.
 *
 * O que se testa aqui é a FRONTEIRA. Do outro lado do link está a internet: o
 * token vale como escopo, mas a linha da assinatura carrega CPF/CNPJ de quem
 * paga, e-mail, telefone e os ids do gateway. Um `select` que virar `include`
 * um dia publica tudo isso, e não haveria erro nenhum pra avisar.
 */
describe("página pública de pagamento", () => {
  const ASSINATURA = {
    status: "AGUARDANDO",
    forma: "PIX_AUTOMATICO",
    ciclo: "MENSAL",
    valorCentavos: 189000,
    proximoVencimento: new Date(Date.UTC(2026, 9, 10)),
    qrCodePayload: "00020101021226790014br.gov.bcb.pix2557pix.asaas.com/qr/cob/abc6304ABCD",
    qrCodeExpiraEm: new Date(Date.now() + 86_400_000),
    conta: { nome: "Transportadora Schaba" },
    cobrancas: [] as unknown[],
  };

  function servico(over: Record<string, unknown> = {}, env: Record<string, string> = {}) {
    let selectUsado: Record<string, unknown> | null = null;
    const gravado: Record<string, unknown>[] = [];
    const prisma = {
      assinatura: {
        findFirst: async (args: { select?: Record<string, unknown> }) => {
          if (args.select) selectUsado = args.select;
          return { ...ASSINATURA, ...over };
        },
        update: async (args: { data: Record<string, unknown> }) => {
          gravado.push(args.data);
          return {};
        },
      },
    };
    const config = { get: (k: string) => env[k] };
    const s = new PagamentoLinkService(prisma as never, config as never);
    return { s, gravado, select: () => selectUsado };
  }

  it("mostra o que o cliente precisa pra pagar", async () => {
    const { s } = servico();
    const p = await s.porToken("tok");

    expect(p.empresa).toBe("Transportadora Schaba");
    // O espaço do `toLocaleString` é NBSP, não espaço comum — comparar com
    // literal aqui quebra por um byte invisível.
    expect(p.valor.replace(/\s/g, " ")).toBe("R$ 1.890,00");
    expect(p.periodicidade).toBe("por mês");
    expect(p.vencimento).toBe("10/10/2026");
    expect(p.situacao).toBe("AGUARDANDO");
    expect(p.pix).toEqual({ codigo: ASSINATURA.qrCodePayload, expirado: false });
  });

  /**
   * Whitelist, nunca blacklist. Se amanhã alguém trocar o `select` por um
   * `include`, ou adicionar um campo sensível à seleção, este teste quebra
   * ANTES de a internet ver o documento de quem paga.
   */
  it("não busca no banco nada que não vá pra tela", async () => {
    const { s, select } = servico();
    await s.porToken("tok");

    const campos = Object.keys(select()!);
    for (const proibido of [
      "documento",
      "emailCobranca",
      "telefoneCobranca",
      "gatewayClienteId",
      "gatewayAssinaturaId",
      "gatewayAutorizacaoId",
      "tokenPagamento",
      "observacao",
    ]) {
      expect(campos, `${proibido} não pode sair daqui`).not.toContain(proibido);
    }
  });

  /**
   * QR vencido não pode virar botão de pagar: o cliente pagaria um código que
   * o banco recusa e voltaria achando que o sistema está quebrado. A página
   * precisa poder dizer "peça outro", e pra isso precisa saber.
   */
  it("diz quando o código já venceu", async () => {
    const { s } = servico({ qrCodeExpiraEm: new Date(Date.now() - 1000) });
    const p = await s.porToken("tok");
    expect(p.pix?.expirado).toBe(true);
  });

  /**
   * Sem código não é o mesmo que "não é Pix". Os dois viram `pix: null` na
   * tela, mas só um deles tem saída — e aconteceu de verdade (14/09/2026, o
   * payload vinha de um campo que o código não lia).
   */
  it("assinatura de Pix sem código devolve pix nulo, sem inventar", async () => {
    const { s } = servico({ qrCodePayload: null });
    const p = await s.porToken("tok");
    expect(p.pix).toBeNull();
    expect(p.linkGateway).toBeNull();
  });

  it("no cartão manda pro gateway, e não finge ter Pix", async () => {
    const { s } = servico({
      forma: "CARTAO",
      cobrancas: [
        {
          vencimento: new Date(Date.UTC(2026, 9, 10)),
          valorCentavos: 189000,
          linkPagamento: "https://www.asaas.com/i/abc123",
        },
      ],
    });
    const p = await s.porToken("tok");
    expect(p.pix).toBeNull();
    expect(p.linkGateway).toBe("https://www.asaas.com/i/abc123");
  });

  it("assinatura cancelada não abre a página", async () => {
    const { s } = servico({ status: "CANCELADA" });
    await expect(s.porToken("tok")).rejects.toMatchObject({
      response: { code: "ASSINATURA_CANCELADA" },
    });
  });

  /**
   * Quem já autorizou e volta no link precisa ver que deu certo. Erro 410 aqui
   * faria o cliente achar que a autorização dele se perdeu — e pagar de novo.
   */
  it("quem já autorizou vê que está tudo certo", async () => {
    const { s } = servico({ status: "ATIVA" });
    const p = await s.porToken("tok");
    expect(p.situacao).toBe("ATIVA");
  });

  /**
   * O token nasce no primeiro uso e nunca muda: link que o cliente guardou no
   * WhatsApp continua valendo, e assinatura criada antes desta tela existir
   * não precisa de backfill.
   */
  it("cria o token uma vez e reaproveita depois", async () => {
    const { s, gravado } = servico(
      { tokenPagamento: null },
      { PUBLIC_APP_URL: "https://app.movatruck.com.br" },
    );
    const url = await s.garantirLink("a1");
    expect(url).toMatch(/^https:\/\/app\.movatruck\.com\.br\/pagar\/[\w-]{32}$/);
    expect(gravado).toHaveLength(1);

    const jaTem = servico(
      { tokenPagamento: "token-existente" },
      { PUBLIC_APP_URL: "https://app.movatruck.com.br" },
    );
    expect(await jaTem.s.garantirLink("a1")).toBe(
      "https://app.movatruck.com.br/pagar/token-existente",
    );
    expect(jaTem.gravado).toHaveLength(0);
  });
});
