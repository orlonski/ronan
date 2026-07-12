import type { CSSProperties, ReactNode } from "react";

/**
 * Métrica compacta pra exibir em cards de lista: label uppercase pequeno
 * em cinza + valor em destaque alinhado à direita.
 *
 * Largura fixa por slot (default 90px) garante que múltiplos cards
 * empilhados ficam com os valores alinhados verticalmente —
 * "coluna Toneladas" do card 1 fica exatamente embaixo da do card 2.
 *
 * `fluid`: no mobile ocupa a largura do container (alinhado à esquerda) e só
 * volta pra largura fixa/alinhado à direita a partir de `sm`. Use quando as
 * métricas ficam num grid no celular pra não estourar a tela.
 */
export function ListMetric({
  label,
  value,
  width = 90,
  fluid = false,
}: {
  label: string;
  value: ReactNode;
  /** Largura fixa em px (a partir de sm quando fluid). Use mais (110+) se o valor for longo. */
  width?: number;
  fluid?: boolean;
}) {
  const style = fluid
    ? ({ "--lm-w": `${width}px` } as CSSProperties)
    : ({ width: `${width}px` } as CSSProperties);
  return (
    <div
      className={
        fluid
          ? "flex w-full min-w-0 flex-col items-start gap-0.5 sm:w-[var(--lm-w)] sm:shrink-0 sm:items-end"
          : "flex shrink-0 flex-col items-end gap-0.5"
      }
      style={style}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="w-full text-sm font-semibold tabular-nums sm:w-auto">{value}</span>
    </div>
  );
}
