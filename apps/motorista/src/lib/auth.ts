import {
  KEY_LEGADA,
  esquecerTudo,
  motoristaAtivoId,
  salvarTokensDe,
  tokensDe,
} from "./sessoes";

export type Tokens = { accessToken: string; refreshToken: string };

/**
 * Token da empresa ATIVA — o motorista pode ter cadastro em mais de uma, cada
 * uma com sessão própria (ver `lib/sessoes.ts`). Enquanto o navegador não tiver
 * migrado pra estrutura nova, cai na chave única antiga: é o que garante que
 * ninguém seja deslogado pela atualização.
 */
export function saveTokens(t: Tokens) {
  const id = motoristaAtivoId();
  if (id) return salvarTokensDe(id, t);
  localStorage.setItem(KEY_LEGADA, JSON.stringify(t));
}

export function loadTokens(): Tokens | null {
  const id = motoristaAtivoId();
  if (id) return tokensDe(id);

  const raw = localStorage.getItem(KEY_LEGADA);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

/** Sai de TODAS as empresas. */
export function clearTokens() {
  esquecerTudo();
  localStorage.removeItem(KEY_LEGADA);
}

export function isLoggedIn() {
  return !!loadTokens();
}
