/**
 * Web Push pra PWA instalada no home screen.
 *
 * iOS 16.4+: Push só funciona com PWA standalone. Em Safari aberto comum,
 * `Notification` existe mas subscribe falha.
 *
 * Backend: envia `provider: 'webpush'` no /m/push-token pra discriminar
 * de FCM (nativo).
 */
import { api } from "./api";

declare global {
  interface Window {
    __VAPID_PUBLIC_KEY?: string;
  }
}

// Chave pública VAPID configurada via VITE_VAPID_PUBLIC_KEY no build, ou
// injetada via <meta> no index.html. Backend tem a privada.
function getVapidKey(): string | null {
  const fromBuild = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (typeof fromBuild === "string" && fromBuild.length > 0) return fromBuild;
  if (typeof window !== "undefined" && window.__VAPID_PUBLIC_KEY) {
    return window.__VAPID_PUBLIC_KEY;
  }
  return null;
}

export function suportaPush(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!("PushManager" in window)) return false;
  return true;
}

export function estadoPermissao(): NotificationPermission | "unsupported" {
  if (!suportaPush()) return "unsupported";
  return Notification.permission;
}

/**
 * Pede permissão, faz subscribe no Service Worker e manda o endpoint pro backend.
 * Idempotente: chamar várias vezes não dói (backend faz upsert por endpoint).
 */
export async function obterEEnviarPushToken(): Promise<void> {
  if (!suportaPush()) return;
  const vapidKey = getVapidKey();
  if (!vapidKey) return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast pra contornar typing estrito (SharedArrayBuffer vs ArrayBuffer)
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
    }
    // Envia o objeto inteiro (endpoint + keys) como JSON serializado.
    // Backend desserializa e armazena por motorista + provider.
    const json = JSON.stringify(sub.toJSON());
    await api.atualizarPushToken(json, "webpush");
  } catch {
    /* sem internet / sw indisponível — não bloqueia o app */
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
