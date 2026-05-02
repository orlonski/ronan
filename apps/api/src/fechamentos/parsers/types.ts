/**
 * Tipos comuns aos parsers de arquivos de fechamento.
 *
 * Cada arquivo (xlsx, csv, pdf) é convertido pra uma estrutura genérica:
 *   - Múltiplas "abas" ou seções
 *   - Cada aba com array de linhas (cada linha = array de células)
 *
 * Depois desse parsing, a IA olha a amostra e decide qual aba/colunas usar.
 */
export type ParsedCell = string | number | null;

export type ParsedSheet = {
  nome: string;
  linhas: ParsedCell[][]; // matriz [linha][coluna]
};

export type ParsedFile = {
  formato: "xlsx" | "csv" | "pdf";
  nomeArquivo: string;
  abas: ParsedSheet[];
};
