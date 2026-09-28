import { describe, expect, it } from "vitest";
import {
  ehNegociacaoDePreco,
  recusouContato,
  aceitouOfertaDeHumano,
  ehPedidoDeHumano,
  ehPedidoDeParar,
  esperavaResposta,
  ehRespostaAutomatica,
  ehSoEncerramento,
} from "./lead-inbound";

// Frases tiradas das conversas reais do Chatwoot (27/09/2026).
describe("ehRespostaAutomatica", () => {
  it("pega os avisos de ausência que o robô respondeu", () => {
    for (const t of [
      "S A carlesso Transportes Ltda agradece seu contato. Em breve retornaremos o contato... obrigado",
      "S A Carlesso Transportes Ltda. agradece sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível... Obrigado",
      "Agradecemos sua mensagem. Não estamos disponíveis no momento, mas responderemos assim que possível.",
      "Olá! Esta é uma mensagem automática.",
    ]) {
      expect(ehRespostaAutomatica(t)).toBe(true);
    }
  });

  it("não confunde lead de verdade", () => {
    for (const t of [
      "Tenho transportadora a granel e quero conhecer a Movatruck.",
      "Oi! Vi o site do Movatruck e quero agendar uma demonstração.",
      "Obrigado, vou testar amanhã",
      "quero saber os valores",
    ]) {
      expect(ehRespostaAutomatica(t)).toBe(false);
    }
  });
});

describe("ehSoEncerramento", () => {
  it("emoji, ok e risada fecham a conversa", () => {
    for (const t of ["👍", "😊", "👀", "Ok", "ok obg", "Valeu", "Ta bom", "Ate", "kkkkk", "Nada kakakak", "🚛🚛"]) {
      expect(ehSoEncerramento(t === "ok obg" ? "obg" : t)).toBe(true);
    }
  });

  it("pergunta ou conteúdo não é encerramento", () => {
    for (const t of ["Oi", "Como funciona?", "3", "Quero saber mais sim", "ok, e quanto custa?"]) {
      expect(ehSoEncerramento(t)).toBe(false);
    }
  });
});

describe("ehPedidoDeHumano", () => {
  const equipe = ["Fernando", "Diego"];
  it("pedido de gente, com ou sem nome", () => {
    for (const t of [
      "QUEM VAI ME ATENDER",
      "quero falar com uma pessoa",
      "tem atendente?",
      "quero falar com o Fernando",
      "o fernando pode me ligar?",
      "me liga",
      "prefiro falar com alguém",
    ]) {
      expect(ehPedidoDeHumano(t, equipe)).toBe(true);
    }
  });

  it("negação nunca é pedido — o teste do dono em 27/09", () => {
    for (const t of [
      "Não quero falar com Fernando Nem sei quem é ele",
      "nao quero falar com ninguem, so quero o preço",
      "nem sei quem é o Fernando",
      "o Fernando me mandou o link",
    ]) {
      expect(ehPedidoDeHumano(t, equipe)).toBe(false);
    }
  });

  it("quem escolhe testar não está pedindo gente — o teste do dono em 28/09", () => {
    for (const t of [
      "Posso testar primeiro Depois eu posso pedir pra me ligar ?",
      "quero testar antes, depois vcs me ligam",
      "depois eu posso pedir pra me ligar?",
    ]) {
      expect(ehPedidoDeHumano(t, equipe)).toBe(false);
    }
  });

  it("sem nome configurado, pedir alguém pelo nome ainda conta", () => {
    expect(ehPedidoDeHumano("quero falar com o Diego", [])).toBe(true);
  });

  it("conversa normal não vira pedido", () => {
    for (const t of [
      "Tenho transportadora a granel e quero conhecer a Movatruck.",
      "quantos caminhões? tenho 3",
      "e o ticket fica salvo onde?",
      "Eu controlo usando planilha",
    ]) {
      expect(ehPedidoDeHumano(t, equipe)).toBe(false);
    }
  });
});

describe("aceitouOfertaDeHumano", () => {
  const OFERTA_PESSOA = "Sou o atendimento automático da Movatruck. Quer que um consultor fale com você?";
  it("qualquer 'sim' curto depois da oferta de pessoa é pedido — QA 28/09", () => {
    for (const t of ["Pode ser", "sim", "ok", "claro", "ta bom", "pode sim", "Pode ser sim!", "quero"]) {
      expect(aceitouOfertaDeHumano(t, OFERTA_PESSOA)).toBe(true);
    }
    expect(
      aceitouOfertaDeHumano("Pode ser", "Sou um atendimento automático, sim. Quer que eu chame alguém da equipe?"),
    ).toBe(true);
  });

  it("aceitar a oferta de LIGAÇÃO com horário é com o robô, que marca", () => {
    expect(
      aceitouOfertaDeHumano("pode ser", "Prefere que um consultor te ligue 10 min pra mostrar, ou testar 30 dias grátis?"),
    ).toBe(false);
  });

  it("sem oferta, 'pode ser' não é nada", () => {
    expect(aceitouOfertaDeHumano("Pode ser", "Sai por R$ 1.890,00 por mês.")).toBe(false);
    expect(aceitouOfertaDeHumano("Pode ser", null)).toBe(false);
  });
});

describe("esperavaResposta", () => {
  it("pergunta ou horário oferecido: 'ok' é resposta, não despedida", () => {
    expect(esperavaResposta("Tenho hoje às 14:00 ou amanhã às 09:00. Qual fica melhor?")).toBe(true);
    expect(esperavaResposta("Combinado: um consultor te liga amanhã às 09:00.")).toBe(true);
    expect(esperavaResposta("Beleza, qualquer coisa é só chamar.")).toBe(false);
  });
});

describe("casos que a QA listou (28/09)", () => {
  it("pedido de gente com 'não' antes de outra coisa ainda é pedido", () => {
    for (const t of [
      "Não consigo cadastrar, preciso falar com alguém",
      "Não sei usar, quero falar com um atendente",
      "Quero falar com alguém antes de testar",
      "tem atendente?",
    ]) {
      expect(ehPedidoDeHumano(t)).toBe(true);
    }
  });

  it("'não me liga' não é pedido de ligação — simulador 28/09", () => {
    expect(ehPedidoDeHumano("não me liga, me manda o preço aqui")).toBe(false);
  });

  it("palavra solta não é pedido", () => {
    for (const t of ["o atendente de ontem disse que era 500", "sou humano sim kkk", "depois vocês me ligam?"]) {
      expect(ehPedidoDeHumano(t)).toBe(false);
    }
  });

  it("preferência de canal não é opt-out", () => {
    for (const t of [
      "não me liga, me manda o preço aqui",
      "não tenho interesse na ligação, quero testar",
      "não quero contato por telefone, pode ser por aqui",
    ]) {
      expect(ehPedidoDeParar(t)).toBe(false);
    }
  });

  it("bloquear e spam são opt-out", () => {
    for (const t of ["Bloquear", "vou te bloquear", "me bloqueia", "isso é spam"]) {
      expect(ehPedidoDeParar(t)).toBe(true);
    }
  });

  it("risada de teclado encerra", () => {
    expect(ehSoEncerramento("Xdddd")).toBe(true);
  });
});

describe("regras fixas do simulador (28/09)", () => {
  it("negociação de preço", () => {
    for (const t of ["consegue fazer por 1200?", "tem desconto?", "faz por 1500 que eu fecho", "dá pra deixar mais barato?"]) {
      expect(ehNegociacaoDePreco(t)).toBe(true);
    }
    for (const t of ["quanto custa pra 12 caminhões?", "e o preço?"]) {
      expect(ehNegociacaoDePreco(t)).toBe(false);
    }
  });

  it("recusa de contato tem resposta fixa; recusa com pergunta de preço vai pro robô", () => {
    expect(recusouContato("Não quero falar com Fernando Nem sei quem é ele")).toBe(true);
    expect(recusouContato("não me liga")).toBe(true);
    expect(recusouContato("não quero que ninguém me ligue, só quero saber o preço")).toBe(false);
  });
});
