import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(typeof body === "object" && body && "message" in body ? String((body as any).message) : `API ${status}`);
  }
}

async function request<T>(
  method: string,
  path: string,
  init: { body?: unknown; token?: string; cache?: RequestCache } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers["authorization"] = `Bearer ${init.token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: init.cache ?? "no-store",
  });

  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text(); }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Cliente da API com token da sessão (server components / route handlers). */
export async function api() {
  const session = await getServerSession(authOptions);
  const token = session?.accessToken;
  return {
    get: <T>(path: string) => request<T>("GET", path, { token }),
    post: <T>(path: string, body: unknown) => request<T>("POST", path, { body, token }),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body, token }),
    delete: <T>(path: string) => request<T>("DELETE", path, { token }),
  };
}

/** Cliente de baixo nível pra login (sem sessão) e demais usos. */
export const apiRaw = {
  post: <T>(path: string, body: unknown) => request<T>("POST", path, { body }),
  get: <T>(path: string) => request<T>("GET", path),
};
