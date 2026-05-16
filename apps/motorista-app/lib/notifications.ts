/**
 * Wrapper enxuto pra expo-notifications. Lazy import evita custo
 * de boot quando o app só precisa do shell.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

let pediuPermissaoUmaVez = false;
let handlerForegroundInstalado = false;

const KEY_ULTIMO_TOKEN = "push:ultimo-token-enviado";
const EXPO_PROJECT_ID_FALLBACK = "33e8e936-fbac-4bb3-9f98-5de6dc84da53";

export async function pedirPermissaoNotificacao(): Promise<boolean> {
  if (pediuPermissaoUmaVez) return true;
  const Notifications = await import("expo-notifications");
  const cur = await Notifications.getPermissionsAsync();
  if (cur.status === "granted") {
    pediuPermissaoUmaVez = true;
    return true;
  }
  const r = await Notifications.requestPermissionsAsync();
  pediuPermissaoUmaVez = r.status === "granted";
  return pediuPermissaoUmaVez;
}

export async function notificarLocal(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const ok = await pedirPermissaoNotificacao();
  if (!ok) return;
  const Notifications = await import("expo-notifications");
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {}, sound: "ding" },
    trigger: null, // imediato
  });
}

/**
 * Sem isso, push em foreground não aparece como banner (default do iOS/Android).
 * Idempotente — chamar várias vezes é seguro.
 */
async function instalarHandlerForeground(): Promise<void> {
  if (handlerForegroundInstalado) return;
  const Notifications = await import("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  handlerForegroundInstalado = true;
}

/**
 * Pede permissão, busca o ExpoPushToken e envia ao backend.
 * Cache em AsyncStorage pra não enviar a cada boot — só quando muda.
 * Erros são silenciosos: push é "nice to have" no boot, não pode bloquear.
 */
export async function obterEEnviarPushToken(): Promise<void> {
  try {
    await instalarHandlerForeground();
    const ok = await pedirPermissaoNotificacao();
    if (!ok) return;

    const Device = await import("expo-device");
    if (!Device.isDevice) return; // emulador/simulador não recebe push real

    const Notifications = await import("expo-notifications");
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? EXPO_PROJECT_ID_FALLBACK;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    const ultimo = await AsyncStorage.getItem(KEY_ULTIMO_TOKEN);
    if (ultimo === token) return;

    const { api } = await import("./api");
    await api.atualizarPushToken(token);
    await AsyncStorage.setItem(KEY_ULTIMO_TOKEN, token);
  } catch {
    /* silencioso — push não pode quebrar o boot do app */
  }
}
