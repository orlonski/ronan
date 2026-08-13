import * as SecureStore from "expo-secure-store";

/**
 * Peças do armazenamento seguro compartilhadas por `auth.ts` e `sessoes.ts`.
 * Moram aqui pra que os dois não precisem importar um ao outro — ciclo de
 * import no caminho de boot é o tipo de coisa que só aparece no aparelho.
 */

export type Tokens = { accessToken: string; refreshToken: string };

/**
 * Chave de quando existia UMA sessão só, antes do motorista poder rodar pra mais
 * de uma empresa. Continua sendo lida como último recurso: enquanto a migração
 * pra sessões por empresa não acontecer (Keychain travado no boot, token que não
 * dá pra decodificar), é ela que mantém o motorista logado.
 */
export const KEY_LEGADA = "ronan.motorista.tokens";

// SecureStore syncroniza com Keychain (iOS) e EncryptedSharedPreferences (Android).
//
// keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY é essencial. O default
// (WHEN_UNLOCKED) proíbe QUALQUER leitura do Keychain com a tela bloqueada — e o
// app tem drains de background (geofence, auto-sync a cada 60s enquanto a task de
// GPS mantém o runtime vivo) que leem o token com o iPhone travado. Sem isso, o
// getItemAsync joga "User interaction is not allowed" (errSecInteractionNotAllowed),
// que estourava no outbox como falso "erro do servidor". AFTER_FIRST_UNLOCK libera
// leitura após o 1º desbloqueio desde o boot; THIS_DEVICE_ONLY evita o token vazar
// pra outro aparelho via iCloud Keychain.
export const KEYCHAIN_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * Erro transitório: o Keychain recusou a leitura porque o device estava
 * bloqueado (errSecInteractionNotAllowed). Não é falha de credencial nem do
 * servidor — resolve sozinho quando o telefone é desbloqueado. O outbox trata
 * como transitório (não queima tentativas, não vira "erro do servidor").
 */
export class KeychainLockedError extends Error {
  constructor(cause?: unknown) {
    super("Keychain bloqueado (device travado). Vai retentar ao desbloquear.");
    this.name = "KeychainLockedError";
    (this as { cause?: unknown }).cause = cause;
  }
}

// SÓ o sinal real de device bloqueado (errSecInteractionNotAllowed). NÃO casar
// "getValueWithKeyAsync" — esse texto aparece em QUALQUER erro de leitura do
// Keychain; casá-lo faria um problema real do Keychain ser engolido como
// "transitório/travado" pra sempre, invisível. Outros erros devem aparecer.
export function ehKeychainBloqueado(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return /User interaction is not allowed|InteractionNotAllowed/i.test(msg);
}
