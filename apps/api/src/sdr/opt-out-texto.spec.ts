import { describe, expect, it } from "vitest";
import { ehPedidoDeParar } from "./lead-inbound";

describe("pedido de parar de receber mensagem", () => {
  it("pega o caso que escapou na bateria do MiniMax-M3", () => {
    expect(ehPedidoDeParar("não quero mais receber mensagem de vocês")).toBe(true);
  });

  it.each([
    "SAIR",
    "para de me mandar mensagem",
    "pare de me enviar mensagens",
    "me tira dessa lista",
    "me remove da base",
    "quero descadastrar",
    "não me mande mais nada",
    "nao tenho interesse",
    "não quero mais ser contatado",
    "para com essas mensagens",
  ])("reconhece: %s", (frase) => {
    expect(ehPedidoDeParar(frase)).toBe(true);
  });

  it.each([
    // Conversa de venda que tem as mesmas palavras — não pode virar opt-out:
    // registrar por engano faz a empresa parar de falar com quem quer comprar.
    "consegue fazer por 1200? não quero pagar mais que isso",
    "quero parar de usar planilha, por isso procurei vocês",
    "não quero mais caminhão parado esperando ticket",
    "me manda mais informação",
    "quero receber a proposta",
    "tenho 8 caminhões",
  ])("não confunde com venda: %s", (frase) => {
    expect(ehPedidoDeParar(frase)).toBe(false);
  });
});
