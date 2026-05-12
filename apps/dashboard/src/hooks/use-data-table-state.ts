"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

export type SortOrder = "asc" | "desc";

export type FilterValues = Record<string, string | undefined>;

/** Estado serializado pra API (já com debounce no q). */
export type DataTableParams = {
  page: number;
  pageSize: number;
  sort?: string;
  order: SortOrder;
  q?: string;
  filters: FilterValues;
};

export type DataTableState = DataTableParams & {
  /** Valor cru do input (sem debounce) pra controlar o input. */
  qInput: string;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSort: (sort: string | undefined, order?: SortOrder) => void;
  setQ: (q: string) => void;
  setFilter: (key: string, value: string | undefined) => void;
  setFilters: (filters: FilterValues) => void;
  reset: () => void;
};

export type UseDataTableStateOptions = {
  /** Ordenação padrão quando nada está aplicado. */
  defaultSort?: { field: string; order?: SortOrder };
  defaultPageSize?: number;
  /** Sincroniza estado com URL (default: true). */
  syncUrl?: boolean;
  /** Debounce do `q` em ms. Default 300. */
  debounceMs?: number;
};

/**
 * Hook que controla page/pageSize/sort/order/q/filters de uma listagem,
 * com sincronização opcional com a URL e debounce no campo de busca.
 *
 * Uso:
 *   const state = useDataTableState({ defaultSort: { field: "nome" } });
 *   const list = usePaginatedList<X>("/admin/x", state);
 */
export function useDataTableState(
  options: UseDataTableStateOptions = {},
): DataTableState {
  const {
    defaultSort,
    defaultPageSize = 10,
    syncUrl = true,
    debounceMs = 300,
  } = options;

  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Lê o estado inicial da URL (se houver) ou usa defaults.
  const initial = React.useMemo(() => {
    if (!syncUrl) {
      return {
        page: 1,
        pageSize: defaultPageSize,
        sort: defaultSort?.field,
        order: (defaultSort?.order ?? "asc") as SortOrder,
        q: undefined as string | undefined,
        filters: {} as FilterValues,
      };
    }
    const params = searchParams;
    const known = new Set(["page", "pageSize", "sort", "order", "q"]);
    const filters: FilterValues = {};
    for (const [k, v] of params.entries()) {
      if (!known.has(k) && v) filters[k] = v;
    }
    return {
      page: Number(params.get("page")) || 1,
      pageSize: Number(params.get("pageSize")) || defaultPageSize,
      sort: params.get("sort") ?? defaultSort?.field,
      order: ((params.get("order") as SortOrder) ?? defaultSort?.order ?? "asc") as SortOrder,
      q: params.get("q") ?? undefined,
      filters,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [page, setPageState] = React.useState(initial.page);
  const [pageSize, setPageSizeState] = React.useState(initial.pageSize);
  const [sort, setSortField] = React.useState<string | undefined>(initial.sort);
  const [order, setOrderState] = React.useState<SortOrder>(initial.order);
  const [qInput, setQInput] = React.useState<string>(initial.q ?? "");
  const [qDebounced, setQDebounced] = React.useState<string | undefined>(initial.q);
  const [filters, setFiltersState] = React.useState<FilterValues>(initial.filters);

  // Debounce do q
  React.useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(qInput.trim() ? qInput.trim() : undefined);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [qInput, debounceMs]);

  // Reset de página quando filtros/q/sort mudam
  React.useEffect(() => {
    setPageState(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDebounced, sort, order, JSON.stringify(filters), pageSize]);

  // URL sync — usa window.history.replaceState pra evitar typedRoutes do Next.
  // É só pra deeplink/refresh; não disparamos navegação.
  React.useEffect(() => {
    if (!syncUrl || typeof window === "undefined") return;
    const next = new URLSearchParams();
    if (page > 1) next.set("page", String(page));
    if (pageSize !== defaultPageSize) next.set("pageSize", String(pageSize));
    if (sort && sort !== defaultSort?.field) next.set("sort", sort);
    if (order !== (defaultSort?.order ?? "asc")) next.set("order", order);
    if (qDebounced) next.set("q", qDebounced);
    for (const [k, v] of Object.entries(filters)) {
      if (v != null && v !== "") next.set(k, v);
    }
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(null, "", url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sort, order, qDebounced, JSON.stringify(filters)]);

  const setPage = React.useCallback((p: number) => setPageState(Math.max(1, p)), []);
  const setPageSize = React.useCallback((s: number) => setPageSizeState(s), []);
  const setSort = React.useCallback((s: string | undefined, o: SortOrder = "asc") => {
    setSortField(s);
    setOrderState(o);
  }, []);
  const setQ = React.useCallback((v: string) => setQInput(v), []);
  const setFilter = React.useCallback((key: string, value: string | undefined) => {
    setFiltersState((prev) => {
      const next = { ...prev };
      if (value == null || value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);
  const setFilters = React.useCallback((f: FilterValues) => setFiltersState(f), []);
  const reset = React.useCallback(() => {
    setQInput("");
    setQDebounced(undefined);
    setFiltersState({});
    setSortField(defaultSort?.field);
    setOrderState(defaultSort?.order ?? "asc");
    setPageState(1);
  }, [defaultSort?.field, defaultSort?.order]);

  return {
    page,
    pageSize,
    sort,
    order,
    q: qDebounced,
    filters,
    qInput,
    setPage,
    setPageSize,
    setSort,
    setQ,
    setFilter,
    setFilters,
    reset,
  };
}
