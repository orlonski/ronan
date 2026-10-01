import { describe, expect, it } from "vitest";
import { AdminRoteamentoWhatsappService } from "./roteamento-whatsapp.service";

/**
 * O corpo que sobe pra Meta tem que sair do catálogo, inteiro.
 *
 * Este endpoint existe justamente pra acabar com a transcrição manual — e uma
 * transcrição errada dentro dele seria pior que a de um humano, porque
 * ninguém conferiria. O que a Meta aprovar é o que ela vai cobrar de nós no
 * primeiro envio: nome, idioma, texto e a QUANTIDADE de exemplos têm que bater
 * com o que `componentes()` do provedor manda depois.
 */
describe("criar template na Meta", () => {
  function servico() {
    const chamadas: { wabaId: string; corpo: Record<string, unknown> }[] = [];
    const meta = {
      criarTemplate: async (wabaId: string, corpo: Record<string, unknown>) => {
        chamadas.push({ wabaId, corpo });
        return { ok: true, resposta: { id: "tpl_1" } };
      },
    };
    const s = new AdminRoteamentoWhatsappService(
      {} as never,
      {} as never,
      meta as never,
      { get: () => "https://app.movatruck.com.br" } as never,
    );
    return { s, chamadas };
  }

  it("monta o corpo do template sem botão a partir do catálogo", async () => {
    const { s, chamadas } = servico();
    await s.criarTemplateNaMeta("waba1", "COBRANCA_ABERTA", "https://www.asaas.com/i/");

    const corpo = chamadas[0]!.corpo as {
      name: string;
      language: string;
      category: string;
      components: { type: string; text?: string; example?: { body_text: string[][] } }[];
    };
    expect(corpo.name).toBe("cobranca_aberta");
    expect(corpo.language).toBe("pt_BR");
    expect(corpo.category).toBe("UTILITY");

    const body = corpo.components.find((c) => c.type === "BODY")!;
    expect(body.text).toContain("{{4}}");

    // Um exemplo por {{n}}, na mesma ordem do corpo — a Meta recusa template
    // com contagem diferente, e recusa exemplo genérico.
    const exemplos = body.example!.body_text[0]!;
    expect(exemplos).toHaveLength(4);
  });

  /**
   * O convite por Pix aponta pra NOSSA página, e o rótulo do botão vem do
   * catálogo.
   *
   * O prefixo continua sendo parâmetro, e não constante de código, porque quem
   * manda nele é o template APROVADO: a Meta o congela e o envio só completa o
   * sufixo. Ter a URL em dois lugares é como o código jura uma coisa e ela
   * entrega outra.
   */
  it("o convite por Pix vira botão Pagar apontando pra nossa página", async () => {
    const { s, chamadas } = servico();
    await s.criarTemplateNaMeta(
      "waba1",
      "COBRANCA_AUTORIZACAO_PIX",
      "https://app.movatruck.com.br/pagar/",
    );

    const corpo = chamadas[0]!.corpo as {
      name: string;
      components: { type: string; text?: string; buttons?: { type: string; text: string; url: string; example: string[] }[] }[];
    };
    expect(corpo.name).toBe("cobranca_autorizacao_pix_link");

    const botao = corpo.components.find((c) => c.type === "BUTTONS")!.buttons![0]!;
    expect(botao.text).toBe("Pagar");
    expect(botao.url).toBe("https://app.movatruck.com.br/pagar/{{1}}");
    // O exemplo do botão é um TOKEN, nunca o copia-e-cola: foi exatamente essa
    // troca que mandou o cliente pra um "a cobrança não existe" em 18/09/2026.
    expect(botao.example[0]).not.toContain("br.gov.bcb.pix");
  });

  it("template com botão de URL exige o prefixo, que não mora no código", async () => {
    const { s, chamadas } = servico();
    await expect(s.criarTemplateNaMeta("waba1", "COBRANCA_ATRASADA")).rejects.toThrow(/urlBase/i);
    expect(chamadas).toHaveLength(0);
  });

  it("com o prefixo, o botão vira URL dinâmica com {{1}} no fim", async () => {
    const { s, chamadas } = servico();
    await s.criarTemplateNaMeta("waba1", "COBRANCA_ATRASADA", "https://www.asaas.com/i/");

    const corpo = chamadas[0]!.corpo as {
      components: { type: string; buttons?: { type: string; url: string }[] }[];
    };
    const botoes = corpo.components.find((c) => c.type === "BUTTONS")!.buttons!;
    expect(botoes[0]!.url).toBe("https://www.asaas.com/i/{{1}}");
  });

  it("template de código não é criado por aqui: a forma dele é outra na Meta", async () => {
    const { s, chamadas } = servico();
    await expect(s.criarTemplateNaMeta("waba1", "OTP_CADASTRO")).rejects.toThrow(/authentication/i);
    expect(chamadas).toHaveLength(0);
  });

  it("rota que não existe falha antes de falar com a Meta", async () => {
    const { s, chamadas } = servico();
    await expect(s.criarTemplateNaMeta("waba1", "NAO_EXISTE")).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });

  it("conferência diária: corpo do catálogo e quatro botões QUICK_REPLY (só o corpo montado, nada vai à Meta)", async () => {
    // O `criarTemplate` aqui é um espião: este teste NÃO submete nada.
    const { s, chamadas } = servico();
    await s.criarTemplateNaMeta("waba1", "CONFERENCIA_DIARIA");

    const corpo = chamadas[0]!.corpo as {
      name: string;
      category: string;
      components: {
        type: string;
        text?: string;
        example?: { body_text: string[][] };
        buttons?: { type: string; text: string; url?: string }[];
      }[];
    };
    expect(corpo.name).toBe("conferencia_diaria");
    expect(corpo.category).toBe("UTILITY");
    const body = corpo.components.find((c) => c.type === "BODY")!;
    expect(body.text).toBe("No dia {{1}}, você não teve viagens? Toque em uma das opções abaixo pra me avisar.");
    expect(body.example!.body_text[0]).toEqual(["sexta, 25/09"]);

    const botoes = corpo.components.find((c) => c.type === "BUTTONS")!.buttons!;
    expect(botoes.map((b) => b.type)).toEqual(["QUICK_REPLY", "QUICK_REPLY", "QUICK_REPLY", "QUICK_REPLY"]);
    expect(botoes.map((b) => b.text)).toEqual([
      "Não tive",
      "Tive, não lancei",
      "Saí da empresa",
      "Parar perguntas",
    ]);
    // Resposta rápida não leva URL nem exige urlBase.
    expect(botoes.every((b) => b.url === undefined)).toBe(true);
  });

  describe("candidatos (texto novo de rota reclassificada)", () => {
    it("cria o convite v2 com o NOME NOVO, UTILITY e o texto do catálogo", async () => {
      const { s, chamadas } = servico();
      await s.criarTemplateNaMeta("waba1", "CONVITE_EMPRESA_V2");
      const corpo = chamadas[0]!.corpo as {
        name: string;
        category: string;
        components: { type: string; text?: string; example?: { body_text: string[][] } }[];
      };
      expect(corpo.name).toBe("convite_empresa_v2");
      expect(corpo.category).toBe("UTILITY");
      const body = corpo.components.find((c) => c.type === "BODY")!;
      expect(body.text).toMatch(/^Convite de cadastro: \{\{1\}\} cadastrou você/);
      expect(body.example!.body_text[0]).toEqual(["Transportes Schaba", "Movatruck"]);
      expect(corpo.components.some((c) => c.type === "BUTTONS")).toBe(false);
    });

    it("cria a cobrança v2 com o mesmo botão Pagar e exige o prefixo", async () => {
      const { s, chamadas } = servico();
      await expect(s.criarTemplateNaMeta("waba1", "COBRANCA_AUTORIZACAO_PIX_V2")).rejects.toThrow(/urlBase/i);
      expect(chamadas).toHaveLength(0);
      await s.criarTemplateNaMeta("waba1", "COBRANCA_AUTORIZACAO_PIX_V2", "https://app.movatruck.com.br/pagar/");
      const corpo = chamadas[0]!.corpo as {
        name: string;
        category: string;
        components: { type: string; buttons?: { text: string; url: string; example: string[] }[] }[];
      };
      expect(corpo.name).toBe("cobranca_autorizacao_pix_link_v2");
      expect(corpo.category).toBe("UTILITY");
      const botao = corpo.components.find((c) => c.type === "BUTTONS")!.buttons![0]!;
      expect(botao.text).toBe("Pagar");
      expect(botao.url).toBe("https://app.movatruck.com.br/pagar/{{1}}");
      expect(botao.example[0]).not.toContain("br.gov.bcb.pix");
    });

    it("templatesMeta lista os candidatos abaixo dos atuais, com a categoria que a Meta deu", async () => {
      const meta = {
        listarTemplates: async () => ({
          ok: true,
          resposta: {
            data: [
              { name: "convite_empresa", language: "pt_BR", status: "APPROVED", category: "MARKETING" },
              { name: "convite_empresa_v2", language: "pt_BR", status: "APPROVED", category: "UTILITY" },
            ],
          },
        }),
      };
      const s = new AdminRoteamentoWhatsappService(
        {} as never,
        {} as never,
        meta as never,
        { get: () => "https://app.movatruck.com.br" } as never,
      );
      const { esperados } = (await s.templatesMeta("waba1")) as {
        esperados: Record<string, unknown>[];
      };
      const normais = esperados.filter((e) => !e.candidato);
      const cands = esperados.filter((e) => e.candidato);
      // candidatos vêm DEPOIS de todos os atuais, e os atuais não ganham o campo
      expect(esperados.slice(-cands.length)).toEqual(cands);
      expect(cands.map((c) => c.rota)).toEqual(["CONVITE_EMPRESA_V2", "COBRANCA_AUTORIZACAO_PIX_V2"]);
      const convite = cands[0]!;
      expect(convite).toMatchObject({
        substitui: "CONVITE_EMPRESA",
        status: "APPROVED",
        categoria: "UTILITY",
        categoriaEsperada: "UTILITY",
        bate: true,
      });
      expect(cands[1]).toMatchObject({ naMeta: "NÃO EXISTE", status: null, categoria: null });
      expect(cands[1]!.urlBaseSugerida).toBe("https://app.movatruck.com.br/pagar/");
      // o atual segue como estava: aprovado, mas MARKETING (a tela avisa)
      expect(normais.find((e) => e.rota === "CONVITE_EMPRESA")).toMatchObject({ categoria: "MARKETING", categoriaEsperada: "UTILITY" });
    });
  });
});
