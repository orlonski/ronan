"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DataTableState } from "@/hooks/use-data-table-state";

export function DataTableToolbar({
  state,
  searchPlaceholder = "Buscar…",
  filters,
  hideSearch,
}: {
  state: DataTableState;
  searchPlaceholder?: string;
  /** Slot pra filtros específicos da tela (selects de status, date ranges, etc). */
  filters?: React.ReactNode;
  hideSearch?: boolean;
}) {
  const hasFilters = Object.values(state.filters).some(
    (v) => v != null && v !== "",
  );
  const hasSearch = !!state.q;
  const showReset = hasFilters || hasSearch;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {!hideSearch && (
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={state.qInput}
              onChange={(e) => state.setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 pl-8"
            />
          </div>
        )}
        {filters}
        {showReset && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.reset}
            className="h-9 text-muted-foreground"
          >
            Limpar
            <X className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Filtro de range de datas (de/ate). Recebe e seta dois valores no state.filters.
 */
export function ToolbarFilterDateRange({
  label,
  fromKey = "de",
  toKey = "ate",
  state,
}: {
  label?: string;
  fromKey?: string;
  toKey?: string;
  state: DataTableState;
}) {
  const from = (state.filters[fromKey] as string | undefined) ?? "";
  const to = (state.filters[toKey] as string | undefined) ?? "";
  return (
    <div className="flex h-9 w-full items-center gap-1.5 rounded-md border bg-background px-2 text-sm sm:w-auto">
      {label && (
        <span className="shrink-0 text-xs text-muted-foreground">{label}:</span>
      )}
      <input
        type="date"
        value={from}
        onChange={(e) => state.setFilter(fromKey, e.target.value || undefined)}
        className="h-7 w-full min-w-0 flex-1 border-0 bg-transparent text-sm focus-visible:outline-none sm:w-auto sm:flex-none"
      />
      <span className="shrink-0 text-muted-foreground">→</span>
      <input
        type="date"
        value={to}
        onChange={(e) => state.setFilter(toKey, e.target.value || undefined)}
        className="h-7 w-full min-w-0 flex-1 border-0 bg-transparent text-sm focus-visible:outline-none sm:w-auto sm:flex-none"
      />
    </div>
  );
}

/**
 * Controle de ordenação pra visões que não têm cabeçalho de coluna clicável
 * (ex: grade de cards). Mesmo `state.sort`/`state.order` da tabela, então
 * trocar de visão preserva a ordenação escolhida.
 */
export function DataTableSortSelect({
  state,
  options,
  className,
}: {
  state: DataTableState;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const current = state.sort ?? options[0]?.value;
  return (
    <div
      className={
        "flex h-9 items-center gap-1.5 rounded-md border bg-background px-2 text-sm" +
        (className ? ` ${className}` : "")
      }
    >
      <span className="shrink-0 text-xs text-muted-foreground">Ordenar por:</span>
      <select
        value={current}
        onChange={(e) => state.setSort(e.target.value, state.order)}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent text-sm focus-visible:outline-none sm:flex-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => state.setSort(current, state.order === "asc" ? "desc" : "asc")}
        className="shrink-0 rounded p-1 hover:bg-muted"
        title={state.order === "asc" ? "Ordem crescente" : "Ordem decrescente"}
      >
        {state.order === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
