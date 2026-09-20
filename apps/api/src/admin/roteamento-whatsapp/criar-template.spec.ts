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
   * O convite por Pix sobe com o BR Code inteiro dentro do botão de copiar.
   *
   * A Meta documenta 15–20 caracteres alfanuméricos pra esse botão, e uma
   * cobrança real de provedor de internet chegou com 180 e pontuação. Esta
   * submissão é o que decide qual das duas coisas vale — e o `example` tem que
   * ser o código de verdade, senão a gente testa outra coisa.
   */
  it("o convite por Pix sobe com o copia-e-cola dentro do botão de copiar", async () => {
    const { s, chamadas } = servico();
    await s.criarTemplateNaMeta("waba1", "COBRANCA_AUTORIZACAO_PIX");

    const corpo = chamadas[0]!.corpo as {
      name: string;
      components: { type: string; text?: string; buttons?: { type: string; example: string }[] }[];
    };
    expect(corpo.name).toBe("cobranca_autorizacao_pix_copia");

    const botao = corpo.components.find((c) => c.type === "BUTTONS")!.buttons![0]!;
    expect(botao.type).toBe("COPY_CODE");
    expect(botao.example).toContain("br.gov.bcb.pix");
    // Botão de copiar não tem prefixo de URL pra pedir: a submissão passou sem
    // `urlBase`, e é isso que a chamada acima prova.
    expect(botao.example.length).toBeGreaterThan(100);
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
});
