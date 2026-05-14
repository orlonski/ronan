"use client";

import { signOut, useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { DataTableParams } from "@/hooks/use-data-table-state";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    // Tenta extrair mensagem útil do body do Nest
    // (formato { message, error, statusCode } ou { message: string[] })
    let msg = `API ${status}`;
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as { message: unknown }).message;
      if (typeof m === "string" && m.length > 0) msg = m;
      else if (Array.isArray(m) && m.length > 0)
        msg = m.map((x) => String(x)).join("; ");
    }
    super(msg);
  }
}

export async function fetchApi<T>(
  path: string,
  opts: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  // Não setar content-type quando body é FormData — o browser preenche
  // automaticamente com multipart/form-data + boundary correto.
  const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body && !isFormData && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
  if (res.status === 401) {
    if (typeof window !== "undefined") signOut({ callbackUrl: "/login" });
    throw new ApiError(401, null);
  }
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = null; }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function useAuthToken(): string | undefined {
  const { data } = useSession();
  return data?.accessToken;
}

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type Paginated<T> = {
  data: T[];
  pagination: Pagination;
};

/**
 * Lista paginada padrão: monta query string a partir dos params (page/pageSize/sort/order/q + filtros)
 * e bate em `GET <path>?<qs>`. Retorna `{ data, pagination }`.
 *
 * Aceita `params` parciais (sem `useDataTableState`) para casos simples.
 */
export function usePaginatedList<T>(
  path: string,
  params: Partial<DataTableParams>,
  options?: { enabled?: boolean; placeholderData?: Paginated<T> },
) {
  const token = useAuthToken();
  const qs = buildQueryString(params);
  const url = qs ? `${path}?${qs}` : path;
  return useQuery({
    queryKey: [path, "list", qs, token],
    enabled: !!token && options?.enabled !== false,
    queryFn: () => fetchApi<Paginated<T>>(url, { token }),
    placeholderData: (prev) => prev ?? options?.placeholderData,
  });
}

/**
 * Carrega TODAS as opções de um recurso paginado (pra usar em selects de FK).
 * Bate em GET <path>?pageSize=200 e retorna `T[]`. Para listas maiores que 200,
 * considere refatorar pra autocomplete server-side.
 */
export function useResourceOptions<T>(
  path: string,
  options?: { enabled?: boolean; pageSize?: number; extraParams?: Record<string, string> },
) {
  const token = useAuthToken();
  const params = new URLSearchParams({ pageSize: String(options?.pageSize ?? 200) });
  if (options?.extraParams) {
    for (const [k, v] of Object.entries(options.extraParams)) {
      if (v) params.set(k, v);
    }
  }
  const url = `${path}?${params.toString()}`;
  return useQuery({
    queryKey: [path, "options", url, token],
    enabled: !!token && options?.enabled !== false,
    queryFn: async () => {
      const res = await fetchApi<Paginated<T>>(url, { token });
      return res.data;
    },
  });
}

/**
 * Carrega um item por id (GET <basePath>/<id>). Usado pelas páginas de edição
 * que rodam em rota própria (/<entidade>/[id]).
 */
export function useResourceItem<T>(basePath: string, id: string | undefined) {
  const token = useAuthToken();
  return useQuery({
    queryKey: [basePath, "item", id, token],
    enabled: !!token && !!id,
    queryFn: () => fetchApi<T>(`${basePath}/${id}`, { token }),
  });
}

export function useCreateResource<TInput, TOutput>(path: string, listPath: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TInput) =>
      fetchApi<TOutput>(path, { method: "POST", body: JSON.stringify(body), token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [listPath] }),
  });
}

export function useUpdateResource<TInput, TOutput>(basePath: string, listPath: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TInput }) =>
      fetchApi<TOutput>(`${basePath}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [listPath] }),
  });
}

export function useDeleteResource(basePath: string, listPath: string) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<void>(`${basePath}/${id}`, { method: "DELETE", token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [listPath] }),
  });
}

function buildQueryString(params: Partial<DataTableParams>): string {
  const usp = new URLSearchParams();
  if (params.page && params.page > 1) usp.set("page", String(params.page));
  if (params.pageSize) usp.set("pageSize", String(params.pageSize));
  if (params.sort) usp.set("sort", params.sort);
  if (params.order && params.order !== "asc") usp.set("order", params.order);
  if (params.q) usp.set("q", params.q);
  if (params.filters) {
    for (const [k, v] of Object.entries(params.filters)) {
      if (v != null && v !== "") usp.set(k, v);
    }
  }
  return usp.toString();
}
