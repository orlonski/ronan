import * as SecureStore from "expo-secure-store";
import { KEYCHAIN_OPTS, ehKeychainBloqueado, KeychainLockedError, type Tokens } from "./keychain";

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

// Espelho em memória pro boot e pra decisão de qual tela mostrar (o AuthGate
// renderiza síncrono e não pode esperar o Keychain).
let _tem: boolean | null = null;
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

/** Já dá pra decidir? `null` = ainda não leu do Keychain. */
export function temIdentidadeSync(): boolean | null {
  return _tem;
}

export async function carregarIdentidade(): Promise<Tokens | null> {
  const t = await tokensIdentidade();
  _tem = !!t?.accessToken;
  avisar();
  return t;
}

export async function tokensIdentidade(): Promise<Tokens | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY, KEYCHAIN_OPTS);
  } catch (err) {
    // Aparelho travado: relança tipado pra virar falha transitória, nunca
    // "sessão acabou" (ver lib/keychain.ts).
    if (ehKeychainBloqueado(err)) throw new KeychainLockedError(err);
    throw err;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

export async function salvarIdentidade(t: Tokens): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(t), KEYCHAIN_OPTS);
  _tem = true;
  avisar();
}

export async function esquecerIdentidade(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY, KEYCHAIN_OPTS).catch(() => {});
  _tem = false;
  avisar();
}

/**
 * Garante a sessão da PESSOA quando só existe a da empresa.
 *
 * O caso é de quem já estava logado quando a identidade entrou no ar: a sessão
 * dela só nascia no login, no cadastro e no reset de senha, e ninguém vai
 * deslogar a frota inteira pra corrigir isso. Sem ela, "Meus gastos" abre vazio
 * pra sempre e o convite nunca toca o aparelho — em silêncio, que é o pior jeito
 * de falhar.
 *
 * Best-effort: sem rede, tenta de novo na próxima abertura.
 */
export async function garantirSessaoDaPessoa(): Promise<void> {
  try {
    if ((await tokensIdentidade())?.accessToken) return;
    const { api } = await import("./api");
    await salvarIdentidade(await api.sessaoDaPessoa());
  } catch {
    /* silencioso — não pode atrapalhar o boot nem o trabalho dele */
  }
}
