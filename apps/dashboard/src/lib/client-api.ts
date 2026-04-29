"use client";

import { signOut, useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

export async function fetchApi<T>(
  path: string,
  opts: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.body && !headers.has("content-type")) headers.set("content-type", "application/json");

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

export function useResourceList<T>(path: string) {
  const token = useAuthToken();
  return useQuery({
    queryKey: [path, token],
    enabled: !!token,
    queryFn: () => fetchApi<T[]>(path, { token }),
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
