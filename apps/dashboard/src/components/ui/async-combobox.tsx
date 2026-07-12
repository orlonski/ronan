"use client";

import { useEffect, useMemo, useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import { usePaginatedList } from "@/lib/client-api";

/** Debounce simples pra não bater na API a cada tecla. */
function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

type BaseProps<T> = {
  /** Endpoint paginado (ex.: "/admin/locais"). Precisa aceitar `q` e `pageSize`. */
  path: string;
  /** Como transformar cada item do backend numa opção do combobox. */
  mapOption: (item: T) => ComboboxOption;
  /** Filtros fixos extras (ex.: { empresaId }). */
  filtros?: Record<string, string | undefined>;
  /** Nº de resultados por busca (default 20). */
  pageSize?: number;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  triggerClassName?: string;
};

/**
 * Combobox de FK com busca no SERVIDOR (autocomplete). Substitui o padrão
 * antigo (useResourceOptions com teto de 200 + filtro client-side), que
 * escondia registros além dos 200 primeiros. Aqui o termo digitado vira `?q=`
 * e o backend devolve os que casam — sem teto.
 *
 * `initialOption`: a opção já selecionada (id + label), pra o trigger mostrar
 * o nome mesmo antes de buscar (essencial em forms de edição). É sempre
 * incluída na lista pra continuar selecionável.
 */
export function AsyncCombobox<T>({
  value,
  onChange,
  initialOption,
  path,
  mapOption,
  filtros,
  pageSize = 20,
  placeholder = "Selecione",
  searchPlaceholder = "Buscar…",
  emptyMessage = "Nada encontrado.",
  className,
  triggerClassName,
}: BaseProps<T> & {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  initialOption?: ComboboxOption;
}) {
  const [termo, setTermo] = useState("");
  const q = useDebounced(termo);
  const list = usePaginatedList<T>(path, {
    q: q.trim() || undefined,
    pageSize,
    filters: filtros,
  });

  const options = useMemo(() => {
    const base = (list.data?.data ?? []).map(mapOption);
    // Garante a opção atual na lista (label no trigger + re-selecionável).
    if (initialOption && !base.some((o) => o.value === initialOption.value)) {
      return [initialOption, ...base];
    }
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, initialOption]);

  return (
    <Combobox
      serverSide
      value={value}
      onChange={onChange}
      options={options}
      onSearchChange={setTermo}
      loading={list.isFetching}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      className={className}
      triggerClassName={triggerClassName}
    />
  );
}

/**
 * Versão multi-select do AsyncCombobox (ex.: "clientes vinculados" a um local).
 * `initialOptions` mantém os já selecionados sempre visíveis como chips mesmo
 * quando a busca atual não os inclui.
 */
export function AsyncComboboxMulti<T>({
  value,
  onChange,
  initialOptions,
  path,
  mapOption,
  filtros,
  pageSize = 20,
  placeholder = "Selecione…",
  searchPlaceholder = "Buscar…",
  emptyMessage = "Nada encontrado.",
  className,
  triggerClassName,
}: BaseProps<T> & {
  value: string[];
  onChange: (values: string[]) => void;
  initialOptions?: ComboboxOption[];
}) {
  const [termo, setTermo] = useState("");
  const q = useDebounced(termo);
  const list = usePaginatedList<T>(path, {
    q: q.trim() || undefined,
    pageSize,
    filters: filtros,
  });

  const options = useMemo(() => {
    const base = (list.data?.data ?? []).map(mapOption);
    const seed = initialOptions ?? [];
    const vistos = new Set(base.map((o) => o.value));
    // Prepend só os selecionados que não vieram na busca atual.
    const faltantes = seed.filter((o) => !vistos.has(o.value));
    return [...faltantes, ...base];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, initialOptions]);

  return (
    <ComboboxMulti
      serverSide
      value={value}
      onChange={onChange}
      options={options}
      onSearchChange={setTermo}
      loading={list.isFetching}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      className={className}
      triggerClassName={triggerClassName}
    />
  );
}
