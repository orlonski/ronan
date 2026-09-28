/**
 * A resposta do modelo pode ir pro WhatsApp de alguém?
 *
 * Existe por um defeito que chegou num cliente: uma pedreira mandou o aviso
 * automático de ausência do WhatsApp Business dela e recebeu de volta, do
 * atendimento da Movatruck, o RACIOCÍNIO do modelo — *"Como a ferramenta me
 * passou a tarefa de responder à última fala do lead (...) --- *(Returning to
 * idle / awaiting real inbound"*. O modelo não tinha como ficar calado, então
 * escreveu sobre ficar calado.
 *
 * Mesma filosofia de `idioma-resposta.ts`: instrução no prompt reduz a chance,
 * só a verificação na saída garante. E a régua é conservadora — descartar uma
 * resposta boa manda a conversa pra uma pessoa, que é o destino de antes;
 * deixar passar metalinguagem manda o bastidor pro cliente.
 */

/** Blocos de raciocínio que alguns modelos devolvem como texto comum. */
const BLOCO_PENSAMENTO = /<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi;

/**
 * Marcas de alguém falando SOBRE a conversa, não NA conversa.
 *
 * Cada item é uma forma que o modelo usa pra se referir ao próprio trabalho —
 * nenhuma aparece numa frase normal de vendedor pra transportador. "lead" é o
 * nome que o sistema dá pra ele; o transportador nunca é chamado assim na cara.
 */
const METALINGUAGEM: RegExp[] = [
  /\breturning to\b/i,
  /\bawaiting\b/i,
  /\bidle\b/i,
  // "é uma ferramenta pra controlar viagem" é frase de venda legítima; o que
  // denuncia é a ferramenta agindo SOBRE ele ("a ferramenta me passou").
  /\bferramenta\s+(?:me|que\s+me)\s+(?:passou|mandou|deu|pediu)\b/i,
  /\b(?:chamar|chamei|chamo|usar|usei)\s+a\s+ferramenta\b/i,
  /\b(?:o|do|ao|pro|pelo)\s+lead\b/i,
  /\bprompt\b/i,
  /\btool(?:_use|s)?\b/i,
  /\bsystem\b/i,
  /\binstruç(?:ão|ões)\s+(?:do|que)\s+(?:sistema|recebi)/i,
  /\bnada\s+(?:a|pra)\s+responder\b/i,
  /\bvou\s+(?:parar|ficar)\s+(?:por\s+aqui|quieto|em\s+sil[eê]ncio)\s+(?:até|ate)\b/i,
  /^\s*-{3,}\s*$/m,
  /\*\(\s*[^)]*\)\*?/,
];

export type ResultadoSaneamento =
  | { ok: true; texto: string }
  | { ok: false; motivo: string; trecho: string };

/**
 * Limpa o que dá pra limpar e recusa o que não dá.
 *
 * O bloco `<think>` é removido: o que vem depois dele costuma ser a resposta
 * de verdade. Metalinguagem no texto final é recusada inteira — cortar a frase
 * esquisita e mandar o resto deixaria meia resposta sem sentido.
 */
/**
 * Travessão não vai pro WhatsApp — pedido do dono (28/09). É a marca mais
 * reconhecível de texto de IA, e o modelo usa mesmo com a regra no prompt.
 * Vira vírgula; "ticket, peso, pedágio — e você fecha" fica
 * "ticket, peso, pedágio, e você fecha".
 */
export function semTravessao(texto: string): string {
  return texto
    .replace(/^\s*[—–]\s*/gm, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*([,.!?:;])/g, "$1")
    .replace(/ {2,}/g, " ");
}

export function sanearResposta(bruto: string): ResultadoSaneamento {
  const texto = semTravessao((bruto ?? "").replace(BLOCO_PENSAMENTO, "").trim());
  for (const padrao of METALINGUAGEM) {
    const m = padrao.exec(texto);
    if (m) {
      const i = m.index;
      return {
        ok: false,
        motivo: "metalinguagem",
        trecho: texto.slice(Math.max(0, i - 30), i + 40).trim(),
      };
    }
  }
  return { ok: true, texto };
}
