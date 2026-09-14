/**
 * Code 128C — o código de barras da chave de acesso.
 *
 * O DACTE é lido por leitor óptico em barreira fiscal e em balança, e o padrão
 * é fixo: CODE-128C, a chave de 44 dígitos, sem nada em volta. Não é escolha
 * nossa nem detalhe de layout — é o que o equipamento do outro lado espera.
 *
 * Escrito aqui em vez de puxar biblioteca por dois motivos. O primeiro é que o
 * formato é pequeno e fechado: uma tabela de 107 padrões e uma soma de
 * verificação, que não mudam nunca. O segundo é que uma dependência a mais numa
 * emissão fiscal é uma superfície a mais pra quebrar num deploy — e o ganho
 * seria de trinta linhas.
 *
 * O "C" do 128C é o que comprime: cada par de dígitos vira UM símbolo, então a
 * chave de 44 cabe em 22. Por isso ele exige quantidade par de dígitos.
 */

/**
 * Os 107 padrões. Cada um tem 6 larguras que se alternam barra/espaço,
 * começando por barra, somando 11 módulos — menos a parada, que tem 7 e soma
 * 13. As larguras são as do próprio padrão: não há o que interpretar aqui.
 */
const PADROES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
];

/** Entra no modo em que cada par de dígitos é um símbolo. */
const INICIO_C = 105;
const PARADA = 106;

/**
 * Os símbolos do código, já com início, verificação e parada.
 *
 * Separado do desenho de propósito: é a parte que dá pra conferir com uma conta
 * na mão, e é onde mora o erro que o olho não vê — um código de barras errado
 * imprime bonito e só falha na barreira, com o caminhão parado.
 */
export function simbolosCode128C(digitos: string): number[] {
  if (!/^\d+$/.test(digitos)) throw new Error("Code 128C só aceita dígitos.");
  if (digitos.length % 2 !== 0) throw new Error("Code 128C exige quantidade par de dígitos.");

  const dados: number[] = [];
  for (let i = 0; i < digitos.length; i += 2) dados.push(Number(digitos.slice(i, i + 2)));

  // A verificação pesa cada símbolo pela POSIÇÃO (1, 2, 3…), contando o início
  // como posição zero. Sem o peso, dois dígitos trocados de lugar passariam.
  let soma = INICIO_C;
  dados.forEach((v, i) => (soma += v * (i + 1)));

  return [INICIO_C, ...dados, soma % 103, PARADA];
}

export type BarraDoCodigo = {
  /** Distância da borda esquerda, em módulos. */
  x: number;
  /** Largura, em módulos. */
  largura: number;
};

/**
 * As barras pretas, em módulos.
 *
 * Devolve medida em MÓDULOS e não em pontos: quem desenha decide a escala, e
 * arredondar cedo é o que produz código que o leitor recusa. Os espaços não
 * voltam na lista porque espaço é ausência de barra — quem desenha só pinta o
 * que é preto.
 */
export function barrasCode128C(digitos: string): { barras: BarraDoCodigo[]; modulos: number } {
  const barras: BarraDoCodigo[] = [];
  let x = 0;
  for (const simbolo of simbolosCode128C(digitos)) {
    const padrao = PADROES[simbolo]!;
    for (let i = 0; i < padrao.length; i++) {
      const largura = Number(padrao[i]);
      // Índice par é barra, ímpar é espaço — o padrão sempre começa em barra.
      if (i % 2 === 0) barras.push({ x, largura });
      x += largura;
    }
  }
  return { barras, modulos: x };
}
