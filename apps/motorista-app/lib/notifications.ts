/**
 * Wrapper enxuto pra expo-notifications. Lazy import evita custo
 * de boot quando o app só precisa do shell.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

let pediuPermissaoUmaVez = false;
let handlerForegroundInstalado = false;
let canalAndroidInstalado = false;

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
 * Cria o canal Android "default" explícito com som customizado + HIGH importance.
 * Sem isso, o canal default auto-criado pelo sistema fica IMPORTANCE_DEFAULT
 * sem som, e push intermitente (vezes sim, vezes não, depende do fabricante).
 * No-op em iOS. Idempotente.
 */
async function instalarCanalAndroid(): Promise<void> {
  if (canalAndroidInstalado) return;
  if (Platform.OS !== "android") {
    canalAndroidInstalado = true;
    return;
  }
  const Notifications = await import("expo-notifications");
  await Notifications.setNotificationChannelAsync("default", {
    name: "Notificações",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "ding", // arquivo em assets/sounds/ding.wav registrado pelo plugin
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#ea580c",
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  canalAndroidInstalado = true;
}

/**
 * Pede permissão, busca o ExpoPushToken e envia ao backend.
 *
 * Reenvia SEMPRE após login (uma vez por abertura) — o POST /m/push-token é
 * idempotente e barato. Antes havia um cache local (`ultimo-token-enviado`)
 * que pulava o envio quando o token não mudava; mas o cache era GLOBAL do
 * aparelho, então se o backend não tivesse o token (troca de motorista no
 * mesmo iPhone, reset/restore de backend) ele nunca mais era reenviado e o
 * motorista ficava sem push — foi exatamente o que travou o iOS. Sempre
 * reenviar se auto-cura. Erros silenciosos: push é "nice to have" no boot.
 */
export async function obterEEnviarPushToken(): Promise<void> {
  try {
    await instalarHandlerForeground();
    await instalarCanalAndroid();

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

    const { api } = await import("./api");
    await api.atualizarPushToken(token);
  } catch {
    /* silencioso — push não pode quebrar o boot do app */
  }
}
