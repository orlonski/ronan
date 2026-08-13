import { randomInt } from "node:crypto";

/**
 * Alfabeto sem os caracteres que o motorista confunde ao ler de um papel ou de
 * uma mensagem: `0`/`O`, `1`/`I`/`L`, `5`/`S`, `2`/`Z`. Sobra o que não gera
 * dúvida — o código vai ser digitado numa tela de celular, muitas vezes com o
 * caminhão parado no sol.
 */
const ALFABETO = "ACDEFGHJKMNPQRTUVWXY346789";

/** Tamanho do sufixo aleatório. 6 caracteres nesse alfabeto dão ~300 milhões. */
const TAMANHO = 6;

/**
 * Código de convite no formato `PREFIXO-XXXXXX` (ex.: `FREITAS-K9M4TX`).
 *
 * O prefixo vem do nome da empresa só pra o motorista reconhecer o que está
 * digitando ("é da Freitas mesmo"). Quem garante unicidade é o sufixo aleatório
 * — e o índice único na coluna, que é a palavra final.
 */
export function gerarCodigoConvite(nomeEmpresa: string): string {
  const prefixo =
    nomeEmpresa
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 7) || "EMPRESA";

  let sufixo = "";
  for (let i = 0; i < TAMANHO; i++) {
    sufixo += ALFABETO[randomInt(ALFABETO.length)];
  }
  return `${prefixo}-${sufixo}`;
}

/**
 * Normaliza o que o motorista digitou pro formato guardado no banco.
 *
 * Aceita minúscula, espaço no meio e — o caso que mais acontece — o código sem
 * o hífen. Como o sufixo tem tamanho fixo, dá pra recolocar o traço no lugar
 * certo sem adivinhação. Recusar um cadastro porque a pessoa digitou
 * `freitask9m4tx` em vez de `FREITAS-K9M4TX` seria implicância com quem está
 * com o caminhão parado no sol.
 */
export function normalizarCodigoConvite(bruto: string): string {
  const limpo = bruto
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ""); // tira espaço, hífen e o que mais vier

  if (limpo.length <= TAMANHO) return limpo;
  return `${limpo.slice(0, -TAMANHO)}-${limpo.slice(-TAMANHO)}`;
}
