import type { Tokens } from "./auth";

/**
 * A sessão da PESSOA — quem ela é, independente de empresa.
 *
 * Diferente das sessões de `lib/sessoes.ts`, que são uma por empresa e são o
 * namespace de tudo que o app guarda: esta não abre dado de operação nenhum. Ela
 * serve pro que é dele e existe antes de qualquer transportadora — o perfil, as
 * placas que ele diz rodar, e os convites que chegam.
 *
 * É o que permite ele se cadastrar sem empresa alguma e ficar logado esperando
 * um convite, em vez de ser jogado de volta pra tela de login sem entender por
 * quê. Ver docs/identidade-motorista.md.
 */
const KEY = "ronan.identidade.tokens";

const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const fn of ouvintes) fn();
}

export function assinarIdentidade(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

export function tokensIdentidade(): Tokens | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

export function temIdentidade(): boolean {
  return !!tokensIdentidade()?.accessToken;
}

export function salvarIdentidade(t: Tokens): void {
  localStorage.setItem(KEY, JSON.stringify(t));
  avisar();
}

export function esquecerIdentidade(): void {
  localStorage.removeItem(KEY);
  avisar();
}
