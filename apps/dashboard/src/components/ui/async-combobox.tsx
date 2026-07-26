"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { ComboboxMulti } from "@/components/ui/combobox-multi";
import { fetchApi, useApiQuery, useAuthToken, usePaginatedList } from "@/lib/client-api";

/** Debounce simples pra não bater na API a cada tecla. */
function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/**
 * Memória das opções já vistas (initialOption, buscas anteriores, resolução por
 * id), indexada por id. Sem isso o label do selecionado some do trigger toda vez
 * que a lista do servidor muda — e o `value` continua lá, filtrando de verdade.
 * É só cache de render (idempotente), por isso mora num ref.
 */
function useOpcoesVistas(
  ...fontes: (ComboboxOption | ComboboxOption[] | undefined)[]
): Map<string, ComboboxOption> {
  const cache = useRef<Map<string, ComboboxOption>>(new Map());
  for (const fonte of fontes) {
    if (!fonte) continue;
    for (const o of Array.isArray(fonte) ? fonte : [fonte]) cache.current.set(o.value, o);
  }
  return cache.current;
}

/** Tempo que uma opção resolvida por id fica fresca (nome de FK muda pouco). */
const RESOLVE_STALE_MS = 5 * 60_000;

type BaseProps<T> = {
  /** Endpoint paginado (ex.: "/admin/locais"). Precisa aceitar `q` e `pageSize`. */
  path: string;
  /** Como transformar cada item do backend numa opção do combobox. */
  mapOption: (item: T) => ComboboxOption;
  /** Filtros fixos extras (ex.: { empresaId }). */
  filtros?: Record<string, string | undefined>;
  /** Nº de resultados por busca (default 20). */
  pageSize?: number;
  /**
   * Resolve o label de um id selecionado que não veio na busca, via
   * `GET <path>/<id>`. Default true — desligue só se o endpoint não tiver
   * rota de item.
   */
  resolvePorId?: boolean;
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
 * Como a lista carregada é só a página atual da busca, um `value` que não está
 * nela (filtro restaurado do localStorage, deeplink, form de edição) não teria
 * label. Duas redes de proteção resolvem isso: `initialOption` (quando o pai já
 * tem o nome em mãos) e, se faltar, um `GET <path>/<id>` sob demanda.
 */
export function AsyncCombobox<T>({
  value,
  onChange,
  initialOption,
  path,
  mapOption,
  filtros,
  pageSize = 20,
  resolvePorId = true,
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

  const buscadas = useMemo(
    () => (list.data?.data ?? []).map(mapOption),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.data],
  );

  const vistas = useOpcoesVistas(initialOption, buscadas);

  // Só busca por id quando o selecionado nunca passou pela lista.
  const idNaoResolvido = resolvePorId && value && !vistas.has(value) ? value : undefined;
  const item = useApiQuery<T>(idNaoResolvido ? `${path}/${idNaoResolvido}` : undefined, {
    staleTime: RESOLVE_STALE_MS,
    retry: false,
  });
  if (idNaoResolvido && item.data) {
    const o = mapOption(item.data);
    if (o.value === idNaoResolvido) vistas.set(o.value, o);
  }

  const selecionada = value ? vistas.get(value) : undefined;

  const options = useMemo(() => {
    // Garante a opção atual na lista (label no trigger + re-selecionável).
    if (selecionada && !buscadas.some((o) => o.value === selecionada.value)) {
      return [selecionada, ...buscadas];
    }
    return buscadas;
  }, [buscadas, selecionada]);

  return (
    <Combobox
      serverSide
      value={value}
      onChange={onChange}
      options={options}
      onSearchChange={setTermo}
      loading={list.isFetching || item.isFetching}
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
 * Mesma lógica do single: `initialOptions` semeia os já selecionados e o que
 * faltar é resolvido por id, pra nenhum chip sumir do trigger.
 */
export function AsyncComboboxMulti<T>({
  value,
  onChange,
  initialOptions,
  path,
  mapOption,
  filtros,
  pageSize = 20,
  resolvePorId = true,
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
  const token = useAuthToken();
  const list = usePaginatedList<T>(path, {
    q: q.trim() || undefined,
    pageSize,
    filters: filtros,
  });

  const buscadas = useMemo(
    () => (list.data?.data ?? []).map(mapOption),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.data],
  );

  const vistas = useOpcoesVistas(initialOptions, buscadas);

  const idsNaoResolvidos = resolvePorId ? value.filter((v) => !vistas.has(v)) : [];
  const resolvidos = useQueries({
    queries: idsNaoResolvidos.map((id) => ({
      queryKey: [path, "item", id],
      enabled: !!token,
      staleTime: RESOLVE_STALE_MS,
      retry: false,
      queryFn: () => fetchApi<T>(`${path}/${id}`, { token }),
    })),
  });
  for (const r of resolvidos) {
    if (!r.data) continue;
    const o = mapOption(r.data);
    vistas.set(o.value, o);
  }

  const selecionadas = useMemo(
    () => value.map((v) => vistas.get(v)).filter((o): o is ComboboxOption => !!o),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, buscadas, resolvidos.map((r) => r.dataUpdatedAt).join()],
  );

  const options = useMemo(() => {
    const vistosNaBusca = new Set(buscadas.map((o) => o.value));
    // Prepend só os selecionados que não vieram na busca atual.
    const faltantes = selecionadas.filter((o) => !vistosNaBusca.has(o.value));
    return [...faltantes, ...buscadas];
  }, [buscadas, selecionadas]);

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
