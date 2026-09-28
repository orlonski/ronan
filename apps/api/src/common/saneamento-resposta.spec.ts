import { describe, expect, it } from "vitest";
import { sanearResposta } from "./saneamento-resposta";

describe("sanearResposta", () => {
  it("recusa o texto que chegou na pedreira em 25/09/2026", () => {
    const real =
      "Esse é um aviso automático de ausência. Faz parte da janela do WhatsApp Business deles " +
      "(no caso, de quem mandou a mensagem). Não é conteúdo do lead. Como a ferramenta me passou " +
      "a tarefa de responder à última fala do lead, e a fala que veio foi só esse aviso, registro " +
      "aqui: a conversa com esse número não tem conteúdo útil do lead ainda — só a presença dele " +
      "na fila. Vou parar por aqui até ele mandar uma mensagem de verdade. Nada pra responder " +
      "agora. --- *(Returning to idle / awaiting real inbound";
    expect(sanearResposta(real).ok).toBe(false);
  });

  it("tira o bloco <think> e deixa a resposta", () => {
    const r = sanearResposta("<think>ele quer preço, chamo consultar_preco</think>Sai por R$ 1.890,00 por mês.");
    expect(r).toEqual({ ok: true, texto: "Sai por R$ 1.890,00 por mês." });
  });

  it("não barra frase normal de venda", () => {
    for (const t of [
      "A Movatruck é uma ferramenta pra controlar viagem de carga a granel.",
      "O Fernando te liga 10 min pra mostrar, ou prefere testar sozinho 30 dias grátis?",
      "Pronto, tirei seu número da nossa lista. Não vamos mais te procurar.",
      "Sai por *R$ 1.890,00* por mês pra até 10 caminhões 🚛",
      "O motorista lança pelo celular — ticket, peso, pedágio, abastecimento.",
    ]) {
      expect(sanearResposta(t)).toEqual({ ok: true, texto: t });
    }
  });

  it("recusa quem fala do próprio trabalho", () => {
    for (const t of [
      "Vou chamar a ferramenta de preço agora.",
      "Não tem nada pra responder aqui.",
      "O lead ainda não disse a frota.",
      "Seguindo o prompt, pergunto a frota.",
    ]) {
      expect(sanearResposta(t).ok).toBe(false);
    }
  });
});
