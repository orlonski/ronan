import { router } from "expo-router";
import { API_URL } from "./api-url";
import { clearTokens, loadTokens, saveTokens, type Tokens } from "./auth";
import { setAuthState } from "./auth-state";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : `API ${status}`,
    );
  }
}

let refreshing: Promise<Tokens | null> | null = null;

async function refresh(): Promise<Tokens | null> {
  if (refreshing) return refreshing;
  const tokens = await loadTokens();
  if (!tokens?.refreshToken) return null;
  refreshing = (async () => {
    try {
      const res = await fetch(`${API_URL}/m/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) return null;
      const fresh = (await res.json()) as Tokens;
      await saveTokens(fresh);
      return fresh;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function request<T>(
  method: string,
  path: string,
  init: { body?: unknown; isFormData?: boolean; auth?: boolean } = { auth: true },
): Promise<T> {
  const { body, isFormData = false, auth = true } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined && !isFormData) headers["content-type"] = "application/json";
  let tokens = auth ? await loadTokens() : null;
  if (tokens) headers["authorization"] = `Bearer ${tokens.accessToken}`;

  const url = `${API_URL}${path}`;
  let res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });

  if (res.status === 401 && auth) {
    const fresh = await refresh();
    if (fresh) {
      headers["authorization"] = `Bearer ${fresh.accessToken}`;
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
      });
    } else {
      await clearTokens();
      setAuthState(false);
      router.replace("/login");
      throw new ApiError(401, null);
    }
  }

  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    throw new ApiError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  postForm: <T>(path: string, body: FormData) =>
    request<T>("POST", path, { body, isFormData: true }),
  loginMotorista: (usuario: string, senha: string) =>
    request<Tokens>("POST", "/m/auth/login", {
      body: { usuario, senha },
      auth: false,
    }),
};
