/**
 * Wrapper enxuto pra expo-notifications. Lazy import evita custo
 * de boot quando o app só precisa do shell.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
// Import estático nomeado: NÃO enumera todos os exports do react-native (o
// `await import("react-native")` fazia isso e disparava o getter legado
// PushNotificationIOS → new NativeEventEmitter(null) → crash no iOS).
import { Alert, Platform } from "react-native";

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
  // DIAG TEMPORÁRIO: rastreia o caminho exato e mostra num Alert no iOS no
  // final (não depende de /erros nem de rede). Se NENHUM alerta aparecer no
  // iPhone, é porque a função nem foi chamada. Remover após diagnosticar.
  let diag = "1-inicio";
  try {
    await instalarHandlerForeground();
    await instalarCanalAndroid();

    const Device = await import("expo-device");
    if (!Device.isDevice) {
      diag = "2-simulador (isDevice=false)";
      return; // emulador/simulador não recebe push real
    }

    const Notifications = await import("expo-notifications");
    let perm = await Notifications.getPermissionsAsync();
    diag = `3-perm.get=${perm.status}`;
    if (perm.status !== "granted") {
      perm = await Notifications.requestPermissionsAsync();
      diag = `4-perm.req=${perm.status}`;
    }
    if (perm.status !== "granted") {
      diag = `5-permissao NEGADA status=${perm.status} canAsk=${perm.canAskAgain}`;
      await reportarDiagPush(`push-diag: ${diag}`, {
        status: perm.status,
        canAskAgain: perm.canAskAgain,
        ios: perm.ios ?? null,
      });
      return;
    }
    pediuPermissaoUmaVez = true;

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? EXPO_PROJECT_ID_FALLBACK;

    diag = "6-chamando getExpoPushTokenAsync";
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) {
      diag = "7-token VAZIO";
      await reportarDiagPush(`push-diag: ${diag}`, { projectId });
      return;
    }
    diag = `8-token OK ${token.slice(0, 24)}…`;

    const ultimo = await AsyncStorage.getItem(KEY_ULTIMO_TOKEN);
    if (ultimo === token) {
      diag = "9-token ja em cache — PULOU envio ao backend";
      return;
    }

    const { api } = await import("./api");
    await api.atualizarPushToken(token);
    await AsyncStorage.setItem(KEY_ULTIMO_TOKEN, token);
    diag = "10-SUCESSO: token enviado ao backend";
  } catch (err) {
    diag = `11-EXCECAO: ${(err as Error)?.message ?? String(err)}`;
    await reportarDiagPush("push-diag: excecao no registro", {}, err);
  } finally {
    // Mostra o resultado direto na tela do iPhone (a forma mais confiável de
    // capturar — não depende de fila de erros nem do dashboard). Alert vem do
    // import estático no topo (dynamic import de react-native crasheava).
    if (Platform.OS === "ios") {
      try {
        Alert.alert("PUSH DIAG (iOS)", diag);
      } catch {
        /* nunca quebra */
      }
    }
  }
}
