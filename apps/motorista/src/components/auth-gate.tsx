import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthState, setAuthState, subscribeAuth } from "@/lib/auth-state";
import { loadTokens } from "@/lib/auth";
import { startAutoSync } from "@/lib/sync";
import { enviarPendentes } from "@/lib/error-reporter";
import { obterEEnviarPushToken } from "@/lib/notifications";

/**
 * Gate de autenticação:
 * - Boot lê tokens do localStorage e atualiza `auth-state` global
 * - Redireciona pra /login se não logado
 * - Re-renderiza ao receber setAuthState (login/logout)
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [, setVersion] = useState(0);
  const location = useLocation();

  // Boot único: lê tokens, popula auth-state
  useEffect(() => {
    if (getAuthState() !== null) return;
    try {
      const tokens = loadTokens();
      setAuthState(!!tokens?.accessToken);
    } catch {
      setAuthState(false);
    }
  }, []);

  // Re-renderiza ao mudar estado (login/logout)
  useEffect(() => subscribeAuth(() => setVersion((v) => v + 1)), []);

  // Inicia auto-sync uma vez por sessão quando logado.
  // Tenta registrar push só se o motorista já deu permissão (não força prompt
  // no boot — Perfil tem botão pra ativar). Idempotente.
  useEffect(() => {
    if (getAuthState() === true) {
      startAutoSync();
      void enviarPendentes();
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        void obterEEnviarPushToken();
      }
    }
  }, [getAuthState()]);

  const state = getAuthState();
  if (state === null) {
    // Ainda lendo localStorage — render imediato ao próximo tick.
    // Não usa loader visual porque é síncrono.
    return null;
  }

  const onLogin = location.pathname === "/login";

  if (!state && !onLogin) return <Navigate to="/login" replace />;
  if (state && onLogin) return <Navigate to="/" replace />;

  return <>{children}</>;
}
