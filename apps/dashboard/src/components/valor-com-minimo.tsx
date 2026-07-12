import { fmtNum } from "@/lib/fechamento-helpers";

type Props = {
  efetivo: string | number;
  real: string | number;
  ajustada: boolean;
  unidade: string;
  casas?: 2 | 3;
  className?: string;
  /**
   * Renderiza "(informado X)" numa linha própria em vez de colado no número.
   * Usar em colunas estreitas (cards de lista) pra não quebrar o valor no meio.
   */
  annotacaoBlock?: boolean;
};

export function ValorComMinimo({
  efetivo,
  real,
  ajustada,
  unidade,
  casas = 2,
  className,
  annotacaoBlock = false,
}: Props) {
  return (
    <span className={className}>
      <span className="whitespace-nowrap">
        {fmtNum(efetivo, casas)} {unidade}
      </span>
      {ajustada && (
        <span
          className={`text-xs font-normal text-muted-foreground ${
            annotacaoBlock ? "block" : "ml-1"
          }`}
        >
          (informado {fmtNum(real, casas)})
        </span>
      )}
    </span>
  );
}
