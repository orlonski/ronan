/**
 * Wrapper enxuto pra expo-notifications. Lazy import evita custo
 * de boot quando o app só precisa do shell.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

let pediuPermissaoUmaVez = false;
let handlerForegroundInstalado = false;
let canalAndroidInstalado = false;

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
 * Cache em AsyncStorage pra não enviar a cada boot — só quando muda.
 * Erros são silenciosos: push é "nice to have" no boot, não pode bloquear.
 */
/**
 * DIAGNÓSTICO TEMPORÁRIO (push iOS não registra token): reporta cada fase de
 * falha do registro pro backend (/errors/motorista → visível em /erros no
 * dashboard), pra cravar POR QUE o iPhone não pega o ExpoPushToken. Antes esse
 * fluxo falhava 100% silencioso. Remover/afrouxar depois de diagnosticar.
 */
async function reportarDiagPush(
  mensagem: string,
  extra: Record<string, unknown>,
  err?: unknown,
): Promise<void> {
  try {
    const { reportarErro } = await import("./error-reporter");
    // Sem err: cria Error sintético com a mensagem descritiva (aparece direto
    // no agrupamento de /erros). Com err: passa o original pra preservar a
    // stack e a mensagem real (ex: erro de entitlement do iOS).
    void reportarErro(err ?? new Error(mensagem), {
      url: "push/registro",
      extra: { plataforma: Platform.OS, ...extra },
    });
  } catch {
    /* o próprio diagnóstico nunca pode quebrar */
  }
}

export async function obterEEnviarPushToken(): Promise<void> {
  try {
    await instalarHandlerForeground();
    await instalarCanalAndroid();

    const Device = await import("expo-device");
    if (!Device.isDevice) {
      await reportarDiagPush("push-diag: rodando em simulador (isDevice=false)", {
        isDevice: false,
      });
      return; // emulador/simulador não recebe push real
    }

    const Notifications = await import("expo-notifications");
    // Checa/pede permissão aqui (em vez de pedirPermissaoNotificacao) pra
    // capturar o status detalhado quando negado — no iOS é a causa #1.
    let perm = await Notifications.getPermissionsAsync();
    if (perm.status !== "granted") {
      perm = await Notifications.requestPermissionsAsync();
    }
    if (perm.status !== "granted") {
      await reportarDiagPush(
        `push-diag: permissao nao concedida (status=${perm.status}, canAskAgain=${perm.canAskAgain})`,
        { status: perm.status, canAskAgain: perm.canAskAgain, ios: perm.ios ?? null },
      );
      return;
    }
    pediuPermissaoUmaVez = true;

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? EXPO_PROJECT_ID_FALLBACK;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) {
      await reportarDiagPush("push-diag: getExpoPushTokenAsync retornou vazio", {
        projectId,
      });
      return;
    }

    const ultimo = await AsyncStorage.getItem(KEY_ULTIMO_TOKEN);
    if (ultimo === token) return;

    const { api } = await import("./api");
    await api.atualizarPushToken(token);
    await AsyncStorage.setItem(KEY_ULTIMO_TOKEN, token);
  } catch (err) {
    // AQUI mora o ouro: o erro real do getExpoPushTokenAsync no iOS
    // (ex: "no valid 'aps-environment' entitlement string found").
    await reportarDiagPush("push-diag: excecao no registro", {}, err);
  }
}
