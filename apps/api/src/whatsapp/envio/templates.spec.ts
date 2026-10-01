import { afterAll, describe, it, expect } from "vitest";
import {
  ROTAS_WHATSAPP,
  TEMPLATES_CANDIDATOS_WHATSAPP,
  TEMPLATES_WHATSAPP,
  achatarParam,
  rotaWhatsapp,
  templateCandidatoWhatsapp,
  type TemplateCandidatoWhatsappDef,
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
  it("o convite por Pix leva link no botão, e nunca o copia-e-cola", () => {
    const def = TEMPLATES_WHATSAPP["COBRANCA_AUTORIZACAO_PIX"]!;
    expect(def).toBeDefined();
    expect(def.botao?.tipo).toBe("URL");
    expect(def.botao?.tipo === "URL" && def.botao.param).toBe(5);
    expect(def.corpo).not.toContain(4);
    expect(def.textoAprovacao).not.toContain("br.gov.bcb.pix");
    // Rótulo próprio: "Abrir" ao lado de um valor em reais não diz o que
    // acontece ao tocar.
    expect(def.botao?.tipo === "URL" && def.botao.texto).toBe("Pagar");
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

  /**
   * A conferência diária tem QUATRO botões de resposta rápida, e o que a Meta
   * exige dela é o que quebra em silêncio se ninguém conferir.
   */
  describe("conferência diária (botões de resposta rápida)", () => {
    const def = TEMPLATES_WHATSAPP["CONFERENCIA_DIARIA"]!;
    const rota = rotaWhatsapp("CONFERENCIA_DIARIA")!;

    it("é utility, só Meta, empresa e não crítica", () => {
      expect(rota.categoria).toBe("utility");
      expect([...rota.provedores]).toEqual(["meta"]);
      expect(rota.escopo).toBe("empresa");
      expect(rota.critica).toBe(false);
    });

    it("tem os quatro botões, na ordem, cada um dentro do limite da Meta", () => {
      expect(def.botao?.tipo).toBe("QUICK_REPLY");
      const rotulos = def.botao?.tipo === "QUICK_REPLY" ? def.botao.rotulos : [];
      expect(rotulos).toEqual(["Não tive", "Tive, não lancei", "Saí da empresa", "Parar perguntas"]);
      // Botão de resposta rápida de TEMPLATE aceita 25 caracteres (o limite de 20 é
      // dos botões de mensagem interativa, que não usamos). A conferir na Meta.
      for (const r of rotulos) expect(r.length).toBeLessThanOrEqual(25);
    });

    it("a variável não está no fim do corpo e não há nome de pessoa", () => {
      expect(def.textoAprovacao.trimEnd().endsWith("}}")).toBe(false);
      expect(def.textoAprovacao).toBe(
        "No dia {{1}}, você não teve viagens? Toque em uma das opções abaixo pra me avisar.",
      );
    });
  });

  /**
   * Candidatos: receitas de texto novo (rota reclassificada pela Meta). Só valem
   * se forem o MESMO formato do atual — é o que faz a troca ser só renomear.
   *
   * O registro está VAZIO de propósito (troca de convite/cobrança feita em
   * 01/10/2026). Pra o mecanismo continuar coberto, o teste injeta um candidato
   * FICTÍCIO que substitui `CONVITE_EMPRESA` e o remove no fim.
   */
  describe("candidatos a substituir template reclassificado", () => {
    const CHAVE_FICTICIA = "CONVITE_EMPRESA_TESTE_FICTICIO";
    const fiction: TemplateCandidatoWhatsappDef = {
      nome: "convite_empresa_teste_ficticio",
      idioma: "pt_BR",
      substitui: "CONVITE_EMPRESA",
      categoria: "utility",
      corpo: [0, 1],
      textoAprovacao:
        "Convite fictício: {{1}} cadastrou você no {{2}}. Se você não reconhece este convite, ignore esta mensagem.",
      exemplo: ["Transportes Schaba", "Movatruck"],
    };
    // Síncrono, no corpo do describe: o it.each abaixo lê o registro na coleta.
    (TEMPLATES_CANDIDATOS_WHATSAPP as Record<string, TemplateCandidatoWhatsappDef>)[CHAVE_FICTICIA] = fiction;
    afterAll(() => {
      delete (TEMPLATES_CANDIDATOS_WHATSAPP as Record<string, TemplateCandidatoWhatsappDef>)[CHAVE_FICTICIA];
    });

    const cands = Object.entries(TEMPLATES_CANDIDATOS_WHATSAPP) as [string, TemplateCandidatoWhatsappDef][];

    it("o candidato fictício está no registro (o mecanismo está sendo exercitado)", () => {
      expect(cands.map(([k]) => k)).toContain(CHAVE_FICTICIA);
    });

    it.each(cands)("%s: nenhuma rota usa a chave nem o nome do candidato", (chave, def) => {
      expect(rotaWhatsapp(chave)).toBeUndefined();
      expect(Object.keys(TEMPLATES_WHATSAPP)).not.toContain(chave);
      const nomesEmUso = Object.values(TEMPLATES_WHATSAPP).map((t) => t!.nome);
      expect(nomesEmUso).not.toContain(def.nome);
      expect(templateCandidatoWhatsapp(chave)).toBe(def);
      expect(templateCandidatoWhatsapp("CONVITE_EMPRESA")).toBeUndefined();
    });

    it.each(cands)("%s: substitui uma rota válida, com nome novo e categoria utility", (_c, def) => {
      const atual = TEMPLATES_WHATSAPP[def.substitui];
      expect(rotaWhatsapp(def.substitui), "substitui rota inexistente").toBeDefined();
      expect(atual, "a rota substituída não tem template").toBeDefined();
      expect(def.nome).not.toBe(atual!.nome);
      expect(def.categoria).toBe("utility");
      expect(def.nome).toMatch(/^[a-z0-9_]+$/);
      expect(def.idioma).toBe(atual!.idioma);
    });

    it.each(cands)("%s: mesma forma de params e botão do atual (troca = só renomear)", (_c, def) => {
      const atual = TEMPLATES_WHATSAPP[def.substitui]!;
      expect([...def.corpo]).toEqual([...atual.corpo]);
      expect(def.botao).toEqual(atual.botao);
      expect([...def.exemplo]).toEqual([...atual.exemplo]);
      expect(placeholders(def.textoAprovacao)).toEqual(
        Array.from({ length: def.corpo.length }, (_, i) => i + 1),
      );
    });

    it.each(cands)("%s: regras da Meta (variável fora das pontas, uma linha, sem emoji)", (_c, def) => {
      const t = def.textoAprovacao;
      expect(t.trimStart().startsWith("{{")).toBe(false);
      expect(t.trimEnd().endsWith("}}")).toBe(false);
      expect(t.trimEnd().endsWith(".")).toBe(true);
      expect(/\p{Extended_Pictographic}/u.test(t)).toBe(false);
      expect(t).not.toContain("\n");
      for (const i of def.corpo) {
        const v = def.exemplo[i] ?? "";
        expect(achatarParam(v)).toBe(v);
      }
    });
  });

  describe("troca de 01/10/2026: convite e cobrança Pix já são os templates v2", () => {
    it("as rotas apontam para os nomes v2, com o texto aprovado", () => {
      expect(TEMPLATES_WHATSAPP.CONVITE_EMPRESA!.nome).toBe("convite_empresa_v2");
      expect(TEMPLATES_WHATSAPP.CONVITE_EMPRESA!.textoAprovacao).toBe(
        "Convite de cadastro: {{1}} cadastrou você como motorista no {{2}}. Para aceitar ou recusar, abra o app com este número. Se você não reconhece este convite, ignore esta mensagem.",
      );
      expect(TEMPLATES_WHATSAPP.COBRANCA_AUTORIZACAO_PIX!.nome).toBe("cobranca_autorizacao_pix_link_v2");
      expect(TEMPLATES_WHATSAPP.COBRANCA_AUTORIZACAO_PIX!.textoAprovacao).toBe(
        "Olá, {{1}}. Autorização de pagamento da assinatura Movatruck: {{2}} por mês, primeiro vencimento em {{3}}. Para autorizar, pague o Pix pelo botão abaixo.",
      );
    });

    it("os nomes v2 não são mais candidatos", () => {
      const nomesCandidatos = Object.values(TEMPLATES_CANDIDATOS_WHATSAPP).map((t) => t.nome);
      expect(nomesCandidatos).not.toContain("convite_empresa_v2");
      expect(nomesCandidatos).not.toContain("cobranca_autorizacao_pix_link_v2");
    });
  });
});
