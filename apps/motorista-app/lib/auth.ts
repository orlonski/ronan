import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  KEYCHAIN_OPTS,
  KEY_LEGADA,
  KeychainLockedError,
  ehKeychainBloqueado,
  type Tokens,
} from "./keychain";
import { esquecerTudo, motoristaAtivoId, salvarTokensDe, tokensDe } from "./sessoes";

export { KeychainLockedError };
export type { Tokens };

const FLAG_MIGRACAO = "ronan.keychain.migrado.v1";

/**
 * Token da empresa ATIVA — o motorista pode ter cadastro em mais de uma, cada
 * uma com sessão própria (ver `lib/sessoes.ts`). Enquanto o aparelho não tiver
 * migrado pra estrutura nova, cai na chave única antiga: é o que garante que
 * ninguém seja deslogado pela atualização.
 */
export async function saveTokens(t: Tokens) {
  const id = await motoristaAtivoId();
  if (id) return salvarTokensDe(id, t);
  await SecureStore.setItemAsync(KEY_LEGADA, JSON.stringify(t), KEYCHAIN_OPTS);
}

export async function loadTokens(): Promise<Tokens | null> {
  const id = await motoristaAtivoId();
  if (id) return tokensDe(id);

  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY_LEGADA, KEYCHAIN_OPTS);
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

/** Sai de TODAS as empresas (botão "Sair"). */
export async function clearTokens() {
  await esquecerTudo();
  await SecureStore.deleteItemAsync(KEY_LEGADA, KEYCHAIN_OPTS).catch(() => {});
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
 *
 * Roda ANTES da migração pra sessões por empresa, e por isso continua olhando a
 * chave legada: nesse ponto do boot é lá que o token ainda está.
 */
export async function migrarProtecaoKeychain(): Promise<void> {
  const jaMigrou = await AsyncStorage.getItem(FLAG_MIGRACAO).catch(() => null);
  if (jaMigrou) return;

  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(KEY_LEGADA, KEYCHAIN_OPTS);
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
    await SecureStore.deleteItemAsync(KEY_LEGADA, KEYCHAIN_OPTS);
    await SecureStore.setItemAsync(KEY_LEGADA, raw, KEYCHAIN_OPTS);
    await AsyncStorage.setItem(FLAG_MIGRACAO, "1").catch(() => {});
  } catch {
    // Falhou no meio: garante que o token não se perca (regrava com `raw` em
    // memória). Não marca a flag — retenta no próximo boot.
    await SecureStore.setItemAsync(KEY_LEGADA, raw, KEYCHAIN_OPTS).catch(() => {});
  }
}
