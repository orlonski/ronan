import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const KEY = "ronan.motorista.tokens";
const FLAG_MIGRACAO = "ronan.keychain.migrado.v1";

export type Tokens = { accessToken: string; refreshToken: string };

// SecureStore syncroniza com Keychain (iOS) e EncryptedSharedPreferences (Android).
// API e armazenamento sao assíncronos diferente do localStorage, mas a interface
// foi pensada pra refletir isso.
//
// keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY é essencial. O default
// (WHEN_UNLOCKED) proíbe QUALQUER leitura do Keychain com a tela bloqueada — e o
// app tem drains de background (geofence, auto-sync a cada 60s enquanto a task de
// GPS mantém o runtime vivo) que leem o token com o iPhone travado. Sem isso, o
// getItemAsync joga "User interaction is not allowed" (errSecInteractionNotAllowed),
// que estourava no outbox como falso "erro do servidor". AFTER_FIRST_UNLOCK libera
// leitura após o 1º desbloqueio desde o boot; THIS_DEVICE_ONLY evita o token vazar
// pra outro aparelho via iCloud Keychain.
const KEYCHAIN_OPTS: SecureStore.SecureStoreOptions = {
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
function ehKeychainBloqueado(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return /User interaction is not allowed|InteractionNotAllowed/i.test(msg);
}

export async function saveTokens(t: Tokens) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(t), KEYCHAIN_OPTS);
}

export async function loadTokens(): Promise<Tokens | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY, KEYCHAIN_OPTS);
  } catch (err) {
    // Device travado: relança tipado pro outbox tratar como transitório em vez
    // de gravar o texto cru do Keychain como "erro do servidor".
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

export async function clearTokens() {
  await SecureStore.deleteItemAsync(KEY, KEYCHAIN_OPTS);
}

/**
 * Regrava o token com a protection class nova (AFTER_FIRST_UNLOCK). Itens
 * gravados antes desse fix ficaram com WHEN_UNLOCKED e continuariam ilegíveis em
 * background. Precisa ser DELETE + SET: um simples setItemAsync num item já
 * existente cai no update() do expo-secure-store, que só troca o valor e NÃO a
 * accessibility (kSecAttrAccessible) — confirmado no nativo. O delete força um
 * SecItemAdd novo com a classe certa.
 *
 * Roda uma vez (flag em AsyncStorage): a partir daí o item persiste na classe
 * nova (refresh futuro só atualiza o valor). Se o Keychain estiver travado ou
 * sem token, não marca a flag — tenta no próximo boot. Guarda `raw` em memória
 * e regrava em caso de falha pra não perder a sessão entre o delete e o set.
 */
export async function migrarProtecaoKeychain(): Promise<void> {
  const jaMigrou = await AsyncStorage.getItem(FLAG_MIGRACAO).catch(() => null);
  if (jaMigrou) return;

  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY, KEYCHAIN_OPTS);
  } catch {
    // Keychain travado/indisponível: tenta de novo no próximo boot.
    return;
  }
  if (!raw) {
    // Deslogado: nada a migrar. Marca pra não reprocessar; o próximo login já
    // grava na classe nova (SecItemAdd em slate limpo).
    await AsyncStorage.setItem(FLAG_MIGRACAO, "1").catch(() => {});
    return;
  }

  try {
    await SecureStore.deleteItemAsync(KEY, KEYCHAIN_OPTS);
    await SecureStore.setItemAsync(KEY, raw, KEYCHAIN_OPTS);
    await AsyncStorage.setItem(FLAG_MIGRACAO, "1").catch(() => {});
  } catch {
    // Falhou no meio: garante que o token não se perca (regrava com `raw` em
    // memória). Não marca a flag — retenta no próximo boot.
    await SecureStore.setItemAsync(KEY, raw, KEYCHAIN_OPTS).catch(() => {});
  }
}
