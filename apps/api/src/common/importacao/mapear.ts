import type { CampoImportavel, EntidadeImportavel } from "./campos";

/**
 * Achar o cabeçalho e casar as colunas sozinho.
 *
 * A planilha que a transportadora manda quase nunca começa na linha 1: tem
 * título, logo, linha em branco, subtítulo. Pedir pro usuário "informe a linha
 * do cabeçalho" é o tipo de pergunta que faz ele desistir da tela.
 */

export type Celula = string | number | null;

/** Tira acento, caixa e pontuação pra comparar "Razão Social" com "razao social". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Qual linha é o cabeçalho.
 *
 * A heurística: é a primeira linha com pelo menos duas células de TEXTO cujos
 * nomes casam com campos conhecidos da entidade. Contar só "células
 * preenchidas" escolheria a linha do título da empresa, que é uma célula só mas
 * está no topo — e daí todo o resto sairia deslocado.
 */
export function acharCabecalho(
  linhas: Celula[][],
  entidade: EntidadeImportavel,
  limite = 30,
): number {
  let melhor = -1;
  let melhorPontos = 0;

  for (let i = 0; i < Math.min(linhas.length, limite); i++) {
    const linha = linhas[i] ?? [];
    let pontos = 0;
    for (const c of linha) {
      if (typeof c !== "string" || c.trim() === "") continue;
      if (campoDoTitulo(c, entidade.campos)) pontos++;
    }
    if (pontos > melhorPontos) {
      melhorPontos = pontos;
      melhor = i;
    }
  }
  // Uma coluna reconhecida só não é cabeçalho: é coincidência (uma célula
  // escrita "nome" no meio dos dados).
  return melhorPontos >= 2 ? melhor : -1;
}

function campoDoTitulo(titulo: string, campos: CampoImportavel[]): CampoImportavel | null {
  const alvo = normalizar(titulo);
  if (alvo === "") return null;
  // Exato primeiro: "cpf" tem que casar com o campo cpf, e não com "cpf cnpj"
  // de outro campo só porque contém a palavra.
  for (const c of campos) {
    if (c.sinonimos.some((s) => normalizar(s) === alvo)) return c;
  }
  for (const c of campos) {
    if (c.sinonimos.some((s) => alvo.includes(normalizar(s)))) return c;
  }
  return null;
}

export type Mapa = Record<string, number>;

/**
 * Que coluna é que campo.
 *
 * Primeira coluna vence em empate: planilha com "Nome" e "Nome Fantasia"
 * resolve pelo que aparece antes, que é o principal na esmagadora maioria.
 */
export function casarColunas(cabecalho: Celula[], entidade: EntidadeImportavel): Mapa {
  const mapa: Mapa = {};
  cabecalho.forEach((celula, indice) => {
    if (typeof celula !== "string") return;
    const campo = campoDoTitulo(celula, entidade.campos);
    if (campo && mapa[campo.chave] === undefined) mapa[campo.chave] = indice;
  });
  return mapa;
}

/** Os obrigatórios que não foram encontrados — o painel pede pra apontar. */
export function faltandoObrigatorios(mapa: Mapa, entidade: EntidadeImportavel): string[] {
  return entidade.campos
    .filter((c) => c.obrigatorio && mapa[c.chave] === undefined)
    .map((c) => c.chave);
}
