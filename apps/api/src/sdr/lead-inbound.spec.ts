import { describe, expect, it } from "vitest";
import {
  aceitouOfertaDeHumano,
  ehPedidoDeHumano,
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
  it("'Pode ser' depois da oferta é pedido", () => {
    expect(
      aceitouOfertaDeHumano(
        "Pode ser",
        "Sou um atendimento automático da Movatruck, sim. Quer que eu chame alguém da equipe pra falar contigo?",
      ),
    ).toBe(true);
    expect(aceitouOfertaDeHumano("sim", "O Fernando te liga 10 min pra mostrar, ou prefere testar sozinho 30 dias grátis?")).toBe(true);
  });

  it("'Pode ser' sem oferta não é", () => {
    expect(aceitouOfertaDeHumano("Pode ser", "Sai por R$ 1.890,00 por mês.")).toBe(false);
    expect(aceitouOfertaDeHumano("Pode ser", null)).toBe(false);
  });
});
