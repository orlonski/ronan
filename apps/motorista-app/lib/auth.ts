import * as SecureStore from "expo-secure-store";

const KEY = "ronan.motorista.tokens";

export type Tokens = { accessToken: string; refreshToken: string };

// SecureStore syncroniza com Keychain (iOS) e EncryptedSharedPreferences (Android).
// API e armazenamento sao assíncronos diferente do localStorage, mas a interface
// foi pensada pra refletir isso.

export async function saveTokens(t: Tokens) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(t));
}

export async function loadTokens(): Promise<Tokens | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync(KEY);
}
