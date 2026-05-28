import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthState, setAuthState, subscribeAuth } from "@/lib/auth-state";
import { loadTokens } from "@/lib/auth";
import { startAutoSync } from "@/lib/sync";
import { enviarPendentes } from "@/lib/error-reporter";
import { obterEEnviarPushToken } from "@/lib/notifications";

/**
 * Gate de autenticação. Usa useSyncExternalStore pra evitar bug de ordem
 * entre boot (que muda o estado global) e subscribe (que escuta mudanças):
 * em produção o boot rodava antes do subscribe e o componente ficava preso
 * em null pra sempre.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, getAuthState, () => null);
  const location = useLocation();

  // Boot único: lê tokens e popula auth-state. useSyncExternalStore re-renderiza
  // automaticamente quando setAuthState muda o valor.
  useEffect(() => {
    if (getAuthState() !== null) return;
    try {
      const tokens = loadTokens();
      setAuthState(!!tokens?.accessToken);
    } catch {
      setAuthState(false);
    }
  }, []);

  // Inicia auto-sync ao logar.
  useEffect(() => {
    if (state !== true) return;
    startAutoSync();
    void enviarPendentes();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      void obterEEnviarPushToken();
    }
  }, [state]);

  if (state === null) return null;

  const onLogin = location.pathname === "/login";
  if (!state && !onLogin) return <Navigate to="/login" replace />;
  if (state && onLogin) return <Navigate to="/" replace />;

  return <>{children}</>;
}
