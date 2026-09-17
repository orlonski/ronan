/**
 * A resposta saiu em português?
 *
 * Existe por um defeito medido, não por precaução: rodando a bateria difícil do
 * SDR com `MiniMax-M2`, a resposta ao pedido de opt-out voltou como *"Tá certo,
 * não vou te писать mais"* — uma palavra em russo no meio da frase. Modelo
 * multilíngue treinado em muitas línguas às vezes troca uma palavra, e no
 * WhatsApp de um transportador isso não é curiosidade: é a mensagem que quebra
 * a confiança da conversa inteira.
 *
 * Prompt não resolve — pedir "escreva em português" já está lá, e mesmo assim
 * aconteceu. Instrução reduz a chance; só a verificação na saída garante.
 *
 * A régua é por ESCRITA, não por dicionário: português se escreve em latim, e
 * qualquer bloco de cirílico, CJK, árabe, hebraico, tailandês ou devanágari é
 * sinal de que o modelo escorregou. Emoji, acento e pontuação passam.
 */

/** Escritas que não aparecem numa frase em português. */
const ESCRITAS_ESTRANHAS =
  /[Ѐ-ӿԀ-ԯ一-鿿぀-ゟ゠-ヿ가-힯؀-ۿ֐-׿฀-๿ऀ-ॿ]/u;

/** O trecho estranho, pra ir pro log — ou `null` quando está tudo em português. */
export function trechoForaDoPortugues(texto: string): string | null {
  const m = ESCRITAS_ESTRANHAS.exec(texto ?? "");
  if (!m) return null;
  // Uma janela em volta do caractere, pra o log mostrar a frase e não uma letra
  // solta que ninguém consegue procurar depois.
  const i = m.index;
  return (texto.slice(Math.max(0, i - 30), i + 30)).trim();
}
