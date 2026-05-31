"use client";

import { LayoutGrid, Table as TableIcon } from "lucide-react";
import type { ListViewMode } from "@/hooks/use-list-view-mode";

/**
 * Toggle visual "Cards / Tabela" pra listas. Compartilhado entre todas
 * as telas (Viagens, Abastecimentos, etc) pra consistência.
 */
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: ListViewMode;
  onChange: (m: ListViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5">
      <button
        type="button"
        onClick={() => onChange("cards")}
        aria-pressed={value === "cards"}
        title="Visualizar como cards"
        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
          value === "cards"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-muted"
        }`}
      >
        <LayoutGrid className="h-3.5 w-3.5" /> Cards
      </button>
      <button
        type="button"
        onClick={() => onChange("table")}
        aria-pressed={value === "table"}
        title="Visualizar como tabela compacta"
        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
          value === "table"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:bg-muted"
        }`}
      >
        <TableIcon className="h-3.5 w-3.5" /> Tabela
      </button>
    </div>
  );
}
