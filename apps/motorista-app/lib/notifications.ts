/**
 * Wrapper enxuto pra expo-notifications. Lazy import evita custo
 * de boot quando o app só precisa do shell.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

let permissaoConcedida = false;
/** Dedup de chamadas concorrentes: 2 diálogos do SO ao mesmo tempo = foco pingando. */
let pedidoEmVoo: Promise<boolean> | null = null;
let handlerForegroundInstalado = false;
let canalAndroidInstalado = false;

const EXPO_PROJECT_ID_FALLBACK = "33e8e936-fbac-4bb3-9f98-5de6dc84da53";

export type StatusPermissaoNotificacao = "granted" | "denied" | "undetermined";

/**
 * Status bruto da permissão de notificação no SO — alimenta a tela de perfil
 * pra distinguir "negou/nunca pediu" de "ligado". Não pede nada; só lê.
 */
export async function statusPermissaoNotificacao(): Promise<StatusPermissaoNotificacao> {
  try {
    const Notifications = await import("expo-notifications");
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return "granted";
    if (status === "undetermined") return "undetermined";
    return "denied";
  } catch {
    return "undetermined";
  }
}

/**
 * Reenvia o push token ao voltar pra foreground — cobre o motorista que ligou
 * a permissão nos Ajustes do SO e voltou pro app sem matar/reabrir (no iOS o
 * popup não reaparece; a recuperação é pelos Ajustes). O caller (_layout) só
 * chama na transição background→active pra não repetir a cada foreground; o
 * boot já registra no login. Idempotente e silencioso.
 */
export async function reenviarPushTokenAoVoltar(): Promise<void> {
  await obterEEnviarPushToken();
}

/**
 * Só abre o popup do SO quando a permissão nunca foi decidida. Quem já negou
 * NÃO é perguntado de novo aqui — a recuperação é pelos Ajustes (o perfil manda
 * pra lá quando o status é "denied").
 *
 * Por que isso importa: `requestPermissionsAsync` lança a activity de permissão
 * do SO, que tira o foco da janela do app — o teclado de um formulário aberto
 * fecha. Como o listener de AppState do _layout re-chama o registro de push a
 * cada background→active, um pedido que sempre falha se realimentava: activity
 * abre (app→inactive, teclado fecha) → fecha na hora por já estar negada
 * (app→active, teclado abre) → listener pede de novo → … Resultado: teclado
 * piscando sem parar, e o motorista sem conseguir digitar. Reproduzido em 2
 * aparelhos; autorizar a notificação "resolvia" só porque matava o ciclo.
 */
export async function pedirPermissaoNotificacao(): Promise<boolean> {
  if (permissaoConcedida) return true;
  if (pedidoEmVoo) return pedidoEmVoo;
  pedidoEmVoo = (async () => {
    const Notifications = await import("expo-notifications");
    const cur = await Notifications.getPermissionsAsync();
    if (cur.status === "granted") {
      permissaoConcedida = true;
      return true;
    }
    // "denied" (ou sem poder re-perguntar) → nem toca no SO.
    if (cur.status !== "undetermined" || cur.canAskAgain === false) return false;
    const r = await Notifications.requestPermissionsAsync();
    permissaoConcedida = r.status === "granted";
    return permissaoConcedida;
  })();
  try {
    return await pedidoEmVoo;
  } finally {
    pedidoEmVoo = null;
  }
}

export async function notificarLocal(
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  // Só checa — nunca pede. Isto roda do watchdog, em hora arbitrária: abrir o
  // popup do SO aqui cairia em cima do motorista no meio de outra coisa.
  if ((await statusPermissaoNotificacao()) !== "granted") return;
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
