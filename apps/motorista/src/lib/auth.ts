const KEY = "ronan.motorista.tokens";

export type Tokens = { accessToken: string; refreshToken: string };

export function saveTokens(t: Tokens) {
  localStorage.setItem(KEY, JSON.stringify(t));
}

export function loadTokens(): Tokens | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Tokens; } catch { return null; }
}

export function clearTokens() {
  localStorage.removeItem(KEY);
}

export function isLoggedIn() {
  return !!loadTokens();
}
