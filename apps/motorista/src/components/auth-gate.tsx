import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAuthState, setAuthState, subscribeAuth } from "@/lib/auth-state";
import { getCadastroStatus, subscribeCadastroStatus } from "@/lib/cadastro-status";
import { loadTokens } from "@/lib/auth";
import { startAutoSync } from "@/lib/sync";
import { enviarPendentes } from "@/lib/error-reporter";
import { obterEEnviarPushToken } from "@/lib/notifications";
import { EmAnalise } from "@/components/em-analise";

/**
 * Gate de autenticação. Usa useSyncExternalStore pra evitar bug de ordem
 * entre boot (que muda o estado global) e subscribe (que escuta mudanças):
 * em produção o boot rodava antes do subscribe e o componente ficava preso
 * em null pra sempre.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, getAuthState, () => null);
  const cadastroStatus = useSyncExternalStore(
    subscribeCadastroStatus,
    getCadastroStatus,
    () => null,
  );
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

  // Rotas públicas (pré-login): login e o fluxo de auto-cadastro.
  const onAuthScreen = location.pathname === "/login" || location.pathname.startsWith("/signup");
  if (!state && !onAuthScreen) return <Navigate to="/login" replace />;
  if (state && onAuthScreen) return <Navigate to="/" replace />;

  // Logado mas cadastro ainda em análise: cobre o app inteiro com a tela de
  // espera (some sozinho quando o status vira APROVADO).
  if (state && cadastroStatus === "PENDENTE_APROVACAO") return <EmAnalise />;

  return <>{children}</>;
}
