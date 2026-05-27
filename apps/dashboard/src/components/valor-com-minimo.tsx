import { fmtNum } from "@/lib/fechamento-helpers";

type Props = {
  efetivo: string | number;
  real: string | number;
  ajustada: boolean;
  unidade: string;
  casas?: 2 | 3;
  className?: string;
};

export function ValorComMinimo({
  efetivo,
  real,
  ajustada,
  unidade,
  casas = 2,
  className,
}: Props) {
  return (
    <span className={className}>
      {fmtNum(efetivo, casas)} {unidade}
      {ajustada && (
        <span className="ml-1 text-xs text-muted-foreground">
          (informado {fmtNum(real, casas)})
        </span>
      )}
    </span>
  );
}
