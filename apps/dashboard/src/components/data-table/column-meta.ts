import type { RowData } from "@tanstack/react-table";

/**
 * Papel da coluna no CARTÃO que o celular mostra no lugar da tabela (abaixo de 768px).
 *  - `titulo`    a linha de cima, em destaque (o nome/identificador). Uma por tabela.
 *  - `subtitulo` linha de apoio logo abaixo do título (cinza).
 *  - `selo`      badge/status, no canto do título.
 *  - `campo`     par "rótulo: valor" na grade do cartão.
 *  - `acoes`     rodapé do cartão (botões da linha). Cliques aqui nunca abrem o cartão.
 *  - `oculta`    não aparece no cartão (só na tabela do desktop).
 * Sem `meta.mobile` vale o palpite sensato: 1ª coluna = título, até 3 campos, coluna `acoes` no fim.
 */
export type MobileColuna = "titulo" | "subtitulo" | "selo" | "campo" | "acoes" | "oculta";

declare module "@tanstack/react-table" {
  // os parâmetros precisam ser idênticos aos da declaração original
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Papel da coluna no cartão do celular. Ver `MobileColuna`. */
    mobile?: MobileColuna;
    /**
     * Rótulo do campo no cartão e na ordenação do celular. Obrigatório quando o `header` não é
     * texto puro (ex.: `DataTableColumnHeader`), senão o valor aparece sem rótulo.
     */
    rotulo?: string;
  }
}
