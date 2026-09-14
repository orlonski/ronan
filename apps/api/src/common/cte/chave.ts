import { CODIGO_UF_IBGE } from "@ronan/shared-types";
import { dvChave, soDigitos } from "../chave-fiscal";

/**
 * Montar a chave de acesso do CT-e — o caminho inverso do `chave-fiscal.ts`,
 * que só sabia LER a chave que alguém digitou.
 *
 * Os 44 dígitos não são um identificador que a gente inventa: eles são
 * calculados a partir do documento, e a SEFAZ refaz essa conta do lado dela. Se
 * um campo aqui divergir do que vai no XML, a rejeição vem como "chave de
 * acesso inválida" e ninguém entende por quê.
 *
 *   2  cUF     código IBGE da UF do EMITENTE (não a da viagem)
 *   4  AAMM    ano e mês da emissão
 *  14  CNPJ    do emitente
 *   2  mod     57
 *   3  série
 *   9  número  sequencial do CT-e
 *   1  tpEmis  forma de emissão (1 = normal)
 *   8  cCT     código numérico
 *   1  cDV     dígito verificador módulo 11
 */

export const MODELO_CTE = "57";

/**
 * Código IBGE de cada UF — os dois primeiros dígitos da chave.
 *
 * É a MESMA tabela que valida o código do município no cadastro: o cUF da
 * chave e o prefixo do código do município são o mesmo número. Ficava
 * duplicada em dois arquivos; agora sai dos tipos compartilhados, que é onde o
 * painel também alcança.
 */
export const CODIGO_UF = CODIGO_UF_IBGE;

export type DadosDaChave = {
  ufEmitente: string;
  cnpjEmitente: string;
  emitidoEm: Date;
  serie: number;
  numero: number;
  /** 1 = normal. Contingência muda este dígito E o cálculo do que vale. */
  tipoEmissao?: number;
  /**
   * O código numérico. Injetável só pra teste: em produção é sorteado, porque
   * é ele que impede alguém de adivinhar a chave do CT-e seguinte.
   */
  codigoNumerico?: number;
};

export type ChaveGerada = { chave: string; codigoNumerico: string; dv: number };

/**
 * O código numérico de 8 dígitos.
 *
 * Não pode ser igual ao número do CT-e — a SEFAZ rejeita (a mesma regra que a
 * NT 2019.001 impôs à NF-e). Sortear e conferir é mais barato que descobrir
 * isso na primeira emissão de verdade.
 */
export function sortearCodigoNumerico(numero: number, sorteio = Math.random): string {
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const n = Math.floor(sorteio() * 100_000_000);
    if (n !== numero) return String(n).padStart(8, "0");
  }
  // Sorteio viciado (teste com stub fixo): desvia do número em vez de travar.
  return String((numero + 1) % 100_000_000).padStart(8, "0");
}

export function gerarChaveCte(dados: DadosDaChave): ChaveGerada {
  const cUF = CODIGO_UF[dados.ufEmitente.toUpperCase()];
  if (!cUF) throw new Error(`UF do emitente inválida: ${dados.ufEmitente}`);

  const cnpj = soDigitos(dados.cnpjEmitente);
  if (cnpj.length !== 14) {
    throw new Error(`CNPJ do emitente precisa ter 14 dígitos; tem ${cnpj.length}.`);
  }
  if (dados.serie < 0 || dados.serie > 999) {
    throw new Error(`Série fora da faixa (0 a 999): ${dados.serie}`);
  }
  if (dados.numero < 1 || dados.numero > 999_999_999) {
    throw new Error(`Número do CT-e fora da faixa (1 a 999.999.999): ${dados.numero}`);
  }

  // AAMM da emissão em horário de Brasília. O container roda em UTC: usar o mês
  // do relógio dele viraria o mês da chave à meia-noite, três horas antes do
  // mês virar pra quem emitiu — e a chave sairia de uma competência que ainda
  // não começou.
  const brasilia = new Date(dados.emitidoEm.getTime() - 3 * 60 * 60 * 1000);
  const aa = String(brasilia.getUTCFullYear()).slice(2);
  const mm = String(brasilia.getUTCMonth() + 1).padStart(2, "0");

  const codigoNumerico =
    dados.codigoNumerico !== undefined
      ? String(dados.codigoNumerico).padStart(8, "0")
      : sortearCodigoNumerico(dados.numero);

  const base43 =
    cUF +
    aa +
    mm +
    cnpj +
    MODELO_CTE +
    String(dados.serie).padStart(3, "0") +
    String(dados.numero).padStart(9, "0") +
    String(dados.tipoEmissao ?? 1) +
    codigoNumerico;

  const dv = dvChave(base43);
  return { chave: base43 + String(dv), codigoNumerico, dv };
}
