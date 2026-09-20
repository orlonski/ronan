import { describe, it, expect } from "vitest";
import {
  ROTAS_WHATSAPP,
  TEMPLATES_WHATSAPP,
  rotaWhatsapp,
  type TemplateWhatsappDef,
} from "@ronan/shared-types";

const entradas = Object.entries(TEMPLATES_WHATSAPP) as [string, TemplateWhatsappDef][];

/** Quantos {{n}} distintos o corpo declara. */
function placeholders(texto: string): number[] {
  const achados = [...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return [...new Set(achados)].sort((a, b) => a - b);
}

describe("catálogo de templates", () => {
  it("tem pelo menos um template", () => {
    expect(entradas.length).toBeGreaterThan(0);
  });

  it.each(entradas)("%s: o corpo declara exatamente os {{n}} que o texto usa", (_rota, def) => {
    // O erro que isto pega: escrever um {{5}} no texto e esquecer o índice no
    // `corpo`. A Meta aceita o template no cadastro e recusa TODA mensagem no
    // envio, dizendo só que a contagem de parâmetros não bate. Aqui o teste
    // falha antes, dizendo qual template é.
    expect(placeholders(def.textoAprovacao)).toEqual(
      Array.from({ length: def.corpo.length }, (_, i) => i + 1),
    );
  });

  it.each(entradas)("%s: nome no formato que a Meta exige", (_rota, def) => {
    // Minúsculas, dígitos e underscore. Nome fora disso a Meta recusa no
    // cadastro — mas quem descobre é quem estiver submetendo, não quem escreveu.
    expect(def.nome).toMatch(/^[a-z0-9_]+$/);
    expect(def.idioma).toBe("pt_BR");
  });

  it.each(entradas)("%s: não lê o mesmo params[] duas vezes no corpo", (_rota, def) => {
    expect(new Set(def.corpo).size).toBe(def.corpo.length);
  });

  it.each(entradas)("%s: a rota existe no catálogo e aceita a Meta", (rota, _def) => {
    const r = rotaWhatsapp(rota);
    expect(r, `rota "${rota}" tem template mas sumiu do catálogo`).toBeDefined();
    expect(r!.provedores as readonly string[]).toContain("meta");
  });

  it("rota de autenticação sempre tem botão de copiar código", () => {
    // Sem o botão, o motorista tem que digitar o código à mão olhando a
    // notificação — que é exatamente o atrito que o template de autenticação
    // da Meta existe pra remover.
    for (const r of ROTAS_WHATSAPP.filter((r) => r.categoria === "authentication")) {
      const def = TEMPLATES_WHATSAPP[r.chave];
      expect(def, `${r.chave} sem template`).toBeDefined();
      expect(def!.botao?.tipo, `${r.chave} sem botão de código`).toBe("COPIAR_CODIGO");
    }
  });

  /**
   * O convite do Pix Automático leva LINK, e o copia-e-cola não entra nele.
   *
   * São dois erros travados de uma vez, os dois já cometidos:
   *
   * 1. Em 18/09/2026 o botão apontava pro Asaas com o sufixo tirado do
   *    copia-e-cola, e o cliente caía num "a cobrança não existe" do próprio
   *    gateway. Na hora de criar a autorização NÃO existe cobrança lá, logo
   *    não existe URL DELES — o botão só pode apontar pra nossa `/pagar/`.
   * 2. A resposta seguinte foi pôr o BR Code no corpo, e aí ninguém conseguia
   *    copiar: no WhatsApp o toque longo copia o balão inteiro, com a saudação
   *    junto, e o banco recusa. O código NÃO pode voltar pro corpo.
   *
   * O índice 4 dos params é o copia-e-cola; o 5 é o sufixo do link. Confundir
   * os dois é literalmente o bug 1.
   */
  it("o convite por Pix leva o código no botão de copiar, nunca no corpo", () => {
    const def = TEMPLATES_WHATSAPP["COBRANCA_AUTORIZACAO_PIX"]!;
    expect(def).toBeDefined();
    // `COPIAR_TEXTO`, não `COPIAR_CODIGO`: o segundo é o do OTP e viaja como
    // `sub_type: "url"`. Trocar um pelo outro a Meta recusa no envio.
    expect(def.botao?.tipo).toBe("COPIAR_TEXTO");
    expect(def.botao?.param).toBe(4);
    // O código FORA do corpo é o ponto: dentro dele, o toque longo copia o
    // balão inteiro com a saudação junto e o banco recusa.
    expect(def.corpo).not.toContain(4);
    expect(def.textoAprovacao).not.toContain("br.gov.bcb.pix");
  });

  /**
   * Os params são compartilhados entre os dois convites, e as posições não
   * podem escorregar: no Pix o botão carrega o CÓDIGO (4), no cartão carrega o
   * SUFIXO DO LINK (5). Em 18/09/2026 um pegou a posição do outro, o sufixo
   * saiu do copia-e-cola e o cliente caiu num "a cobrança não existe" do Asaas.
   */
  it("cada convite puxa a ponta certa dos params", () => {
    expect(TEMPLATES_WHATSAPP["COBRANCA_AUTORIZACAO_PIX"]!.botao?.param).toBe(4);
    expect(TEMPLATES_WHATSAPP["COBRANCA_AUTORIZACAO"]!.botao?.param).toBe(5);
  });

  it("toda rota da Meta sem template é texto livre de propósito", () => {
    // Rota `utility`/`authentication` sem template NÃO sai fora da janela de
    // 24h. Se uma aparecer aqui, ou ganhou template ou virou serviço — e
    // qualquer um dos dois é decisão, não esquecimento.
    //
    // As duas que sobram são texto que uma pessoa digitou na hora: não existe
    // template possível, e isso é a natureza delas, não pendência.
    const semTemplate = ROTAS_WHATSAPP.filter(
      (r) => (r.provedores as readonly string[]).includes("meta") && !TEMPLATES_WHATSAPP[r.chave],
    ).map((r) => r.chave);
    expect(semTemplate.sort()).toEqual(["MENSAGEM_AVULSA", "RESPOSTA_AGENTE"]);
  });
});
