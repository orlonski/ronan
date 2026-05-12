import * as React from "react";
import { cn } from "@/lib/utils";

type Option = { value: string; primary: string; secondary?: string };

type Props = {
  options: Option[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  emptyLabel?: string;
  className?: string;
  searchPlaceholder?: string;
  /** Se setado, renderiza radio "padrão" entre os selecionados */
  defaultValue?: string | null;
  onDefaultChange?: (next: string | null) => void;
};

/**
 * Lista de checkboxes com busca. Quando defaultValue + onDefaultChange são
 * passados, mostra um radio "padrão" entre os itens selecionados.
 */
export function MultiCheckList({
  options,
  selectedIds,
  onChange,
  emptyLabel = "Nenhum item disponível.",
  className,
  searchPlaceholder = "Buscar...",
  defaultValue,
  onDefaultChange,
}: Props) {
  const [busca, setBusca] = React.useState("");
  const filtradas = busca.trim()
    ? options.filter((o) => {
        const q = busca.toLowerCase();
        return (
          o.primary.toLowerCase().includes(q) ||
          (o.secondary?.toLowerCase().includes(q) ?? false)
        );
      })
    : options;

  function toggle(value: string) {
    if (selectedIds.includes(value)) {
      onChange(selectedIds.filter((v) => v !== value));
      // Se removeu o que era padrão, limpa default
      if (defaultValue === value && onDefaultChange) onDefaultChange(null);
    } else {
      const next = [...selectedIds, value];
      onChange(next);
      // Se era o primeiro, vira default automaticamente
      if (next.length === 1 && onDefaultChange) onDefaultChange(value);
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input
        type="text"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={searchPlaceholder}
        className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="max-h-56 overflow-y-auto rounded-md border bg-background">
        {filtradas.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">{emptyLabel}</p>
        )}
        {filtradas.map((o) => {
          const checked = selectedIds.includes(o.value);
          const showDefault = onDefaultChange && checked && selectedIds.length > 1;
          return (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(o.value)}
                className="h-4 w-4 shrink-0 accent-blue-600"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{o.primary}</p>
                {o.secondary && (
                  <p className="truncate text-xs text-muted-foreground">{o.secondary}</p>
                )}
              </div>
              {showDefault && (
                <label
                  className="ml-2 flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="radio"
                    name="default-veiculo"
                    checked={defaultValue === o.value}
                    onChange={() => onDefaultChange?.(o.value)}
                    className="h-3 w-3 accent-blue-600"
                  />
                  padrão
                </label>
              )}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {selectedIds.length} selecionado{selectedIds.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}
