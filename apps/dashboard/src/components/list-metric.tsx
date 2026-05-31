import type { ReactNode } from "react";

/**
 * Métrica compacta pra exibir em cards de lista: label uppercase pequeno
 * em cinza + valor em destaque alinhado à direita.
 *
 * Largura fixa por slot (default 90px) garante que múltiplos cards
 * empilhados ficam com os valores alinhados verticalmente —
 * "coluna Toneladas" do card 1 fica exatamente embaixo da do card 2.
 */
export function ListMetric({
  label,
  value,
  width = 90,
}: {
  label: string;
  value: ReactNode;
  /** Largura fixa em px. Use mais (110+) quando o valor for muito longo. */
  width?: number;
}) {
  return (
    <div
      className="flex shrink-0 flex-col items-end gap-0.5"
      style={{ width: `${width}px` }}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}
