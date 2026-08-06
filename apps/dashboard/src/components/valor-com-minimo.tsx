import { fmtNum } from "@/lib/fechamento-helpers";

type Props = {
  /**
   * Valor faturado (após o mínimo). Ausente pra quem não tem
   * `viagens.ver-comercial` — o backend omite do payload —, e aí mostramos o
   * real, que é o que o motorista lançou. Nunca deixar o número sumir: km e
   * toneladas são dado operacional, não comercial.
   */
  efetivo?: string | number | null;
  real: string | number;
  ajustada?: boolean;
  unidade: string;
  casas?: 2 | 3;
  className?: string;
  /**
   * Esconde o "(informado X)": mostra só o valor faturado, com o real no title.
   * Usar em cards de lista — a diferença entre real e mínimo é assunto da tela
   * de detalhe da viagem, no card só polui.
   */
  semAnotacao?: boolean;
};

export function ValorComMinimo({
  efetivo,
  real,
  ajustada,
  unidade,
  casas = 2,
  className,
  semAnotacao = false,
}: Props) {
  return (
    <span
      className={className}
      title={
        ajustada && semAnotacao
          ? `Informado ${fmtNum(real, casas)} ${unidade} — ajustado pelo mínimo`
          : undefined
      }
    >
      <span className="whitespace-nowrap">
        {fmtNum(efetivo ?? real, casas)} {unidade}
      </span>
      {ajustada && !semAnotacao && (
        <span className="ml-1 text-xs font-normal text-muted-foreground">
          (informado {fmtNum(real, casas)})
        </span>
      )}
    </span>
  );
}
