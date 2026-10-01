"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { temFiltroDoUsuario, type DataTableState } from "@/hooks/use-data-table-state";

/**
 * Quantos filtros ALGUÉM escolheu (diferentes do padrão da tela — o mesmo critério do "Limpar filtros").
 * A busca não conta (fica sempre à vista) e um intervalo de datas (`de` + `ate`) conta como UM filtro.
 */
export function contarFiltrosAtivos(state: DataTableState): number {
  const padrao = state.filtrosPadrao ?? {};
  const chaves = new Set([...Object.keys(state.filters), ...Object.keys(padrao)]);
  const mudou = (k: string) => (state.filters[k] ?? "") !== (padrao[k] ?? "");
  let n = 0;
  let intervalo = false;
  for (const k of chaves) {
    if (!mudou(k)) continue;
    if (k === "de" || k === "ate") {
      if (!intervalo) n++;
      intervalo = true;
    } else n++;
  }
  return n;
}

/**
 * Barra de busca + filtros de uma lista.
 *
 * No desktop (md+) nada mudou: busca e filtros lado a lado, com "Limpar filtros".
 * No celular (< 768px) vira UMA linha — busca + botão "Filtros (n)" — e os filtros abrem numa
 * folha de baixo com "Limpar" e "Aplicar" de 44px. São os MESMOS controles e o MESMO estado/URL
 * (`state.setFilter`): o slot `filters` é renderizado duas vezes (inline, escondido no celular, e dentro
 * da folha, só enquanto aberta) — nenhuma lógica de filtro foi reimplementada.
 */
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
  // Só conta filtro que ALGUÉM escolheu — o padrão da tela não é filtro.
  const showReset = temFiltroDoUsuario(state);
  const [folha, setFolha] = React.useState(false);
  const ativos = contarFiltrosAtivos(state);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2 max-md:flex-nowrap">
        {!hideSearch && (
          <div className="relative w-full sm:max-w-xs max-md:min-w-0 max-md:flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={state.qInput}
              onChange={(e) => state.setQ(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 pl-8"
            />
          </div>
        )}
        {filters && (
          <Button
            type="button"
            variant={ativos > 0 ? "default" : "outline"}
            onClick={() => setFolha(true)}
            aria-label={ativos > 0 ? `Filtros, ${ativos} ativos` : "Filtros"}
            className="md:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros{ativos > 0 ? ` (${ativos})` : ""}
          </Button>
        )}
        {filters && <div className="contents max-md:hidden">{filters}</div>}
        {showReset && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.reset}
            className="h-9 text-muted-foreground max-md:hidden"
            aria-label="Limpar os filtros aplicados"
          >
            Limpar filtros
            <X className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {filters && folha && (
        <Dialog open onOpenChange={(o) => !o && setFolha(false)}>
          <DialogContent className="max-w-md" data-folha-filtros>
            <DialogHeader>
              <DialogTitle>{ativos > 0 ? `Filtros (${ativos})` : "Filtros"}</DialogTitle>
              <DialogDescription className="sr-only">
                Escolha os filtros da lista. A lista atualiza na hora.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 [&>*]:w-full">{filters}</div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  state.reset();
                  setFolha(false);
                }}
              >
                Limpar
              </Button>
              <Button type="button" onClick={() => setFolha(false)}>
                Aplicar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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
        className="h-7 w-full min-w-0 flex-1 border-0 bg-transparent text-sm max-md:text-base focus-visible:outline-none sm:w-auto sm:flex-none"
      />
      <span className="shrink-0 text-muted-foreground">→</span>
      <input
        type="date"
        value={to}
        onChange={(e) => state.setFilter(toKey, e.target.value || undefined)}
        className="h-7 w-full min-w-0 flex-1 border-0 bg-transparent text-sm max-md:text-base focus-visible:outline-none sm:w-auto sm:flex-none"
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
      <span className="shrink-0 text-xs text-muted-foreground max-md:text-sm">Ordenar por:</span>
      <select
        value={current}
        onChange={(e) => state.setSort(e.target.value, state.order)}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent text-sm max-md:text-base focus-visible:outline-none sm:flex-none"
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
