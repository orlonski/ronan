/**
 * Wrapper enxuto pra expo-notifications. Lazy import evita custo
 * de boot quando o app só precisa do shell.
 */

let pediuPermissaoUmaVez = false;

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
    content: { title, body, data: data ?? {}, sound: "default" },
    trigger: null, // imediato
  });
}
