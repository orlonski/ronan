/**
 * A chave de acesso de 44 dígitos dos documentos fiscais eletrônicos.
 *
 * Guardar chave errada é pior que não guardar: ela vai parecer conferida na
 * tela, vai entrar em relatório e só vai falhar no dia em que alguém tentar
 * consultar o documento na SEFAZ — provavelmente na auditoria.
 *
 * A chave não é um número opaco: ela carrega UF, competência, CNPJ do emitente,
 * modelo, série, número e um dígito verificador módulo 11. Dá pra conferir tudo
 * isso offline, de graça, na hora em que a pessoa digita.
 */

/** Modelos que interessam aqui. */
export const MODELOS_FISCAIS = {
  "55": "NF-e",
  "57": "CT-e",
  "58": "MDF-e",
  "65": "NFC-e",
  "67": "CT-e OS",
} as const;

export type ModeloFiscal = keyof typeof MODELOS_FISCAIS;

export type ChaveFiscal = {
  chave: string;
  uf: string;
  /** "AAMM" da emissão. */
  competencia: string;
  cnpjEmitente: string;
  modelo: string;
  nomeModelo: string;
  serie: string;
  numero: string;
};

/** Códigos de UF do IBGE, que são os dois primeiros dígitos da chave. */
const UF_POR_CODIGO: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR",
  "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

export function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * Dígito verificador da chave (módulo 11, pesos de 2 a 9 da direita pra
 * esquerda). É o mesmo cálculo do CNPJ, e é o que pega erro de digitação —
 * trocar dois dígitos de lugar muda o DV.
 */
export function dvChave(base43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += Number(base43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  // Resto 0 ou 1 → DV 0. É a regra da SEFAZ, não um arredondamento nosso.
  return resto < 2 ? 0 : 11 - resto;
}

export type ResultadoChave =
  | { ok: true; dados: ChaveFiscal }
  | { ok: false; motivo: string };

/**
 * Valida e destrincha a chave. Devolve o motivo em português de gente, porque
 * quem vê isso é quem está digitando — "chave inválida" não ajuda ninguém a
 * descobrir que colou 43 dígitos.
 */
export function lerChaveFiscal(entrada: string, modeloEsperado?: ModeloFiscal): ResultadoChave {
  const chave = soDigitos(entrada);
  if (chave.length === 0) return { ok: false, motivo: "Informe a chave." };
  if (chave.length !== 44) {
    return {
      ok: false,
      motivo: `A chave tem 44 números; você informou ${chave.length}.`,
    };
  }

  const codigoUf = chave.slice(0, 2);
  const uf = UF_POR_CODIGO[codigoUf];
  if (!uf) return { ok: false, motivo: `Os dois primeiros números (${codigoUf}) não são de um estado válido.` };

  const competencia = chave.slice(2, 6);
  const mes = Number(competencia.slice(2, 4));
  if (mes < 1 || mes > 12) {
    return { ok: false, motivo: `O mês de emissão na chave (${competencia.slice(2, 4)}) não existe.` };
  }

  const modelo = chave.slice(20, 22);
  const nomeModelo = MODELOS_FISCAIS[modelo as ModeloFiscal];
  if (!nomeModelo) {
    return { ok: false, motivo: `Modelo de documento desconhecido (${modelo}).` };
  }
  if (modeloEsperado && modelo !== modeloEsperado) {
    // Colar a chave da NF-e no campo do CT-e é o erro mais provável do mundo, e
    // o dígito verificador não pega — a chave é válida, só é de outro documento.
    return {
      ok: false,
      motivo: `Essa chave é de ${nomeModelo}, e aqui vai a de ${MODELOS_FISCAIS[modeloEsperado]}.`,
    };
  }

  const dvInformado = Number(chave[43]);
  const dvCalculado = dvChave(chave.slice(0, 43));
  if (dvInformado !== dvCalculado) {
    return {
      ok: false,
      motivo: "A chave não confere — falta ou sobra um número, ou dois ficaram trocados.",
    };
  }

  return {
    ok: true,
    dados: {
      chave,
      uf,
      competencia,
      cnpjEmitente: chave.slice(6, 20),
      modelo,
      nomeModelo,
      serie: chave.slice(22, 25),
      numero: chave.slice(25, 34),
    },
  };
}

/** Atalho pra Zod e afins. */
export function chaveFiscalValida(entrada: string, modelo?: ModeloFiscal): boolean {
  return lerChaveFiscal(entrada, modelo).ok;
}
