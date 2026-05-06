import "../global.css";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, router, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/error-boundary";
import { loadTokens } from "@/lib/auth";
import {
  enviarPendentes,
  instalarHandlersGlobais,
} from "@/lib/error-reporter";
import {
  getAuthState,
  setAuthState,
  subscribeAuth,
} from "@/lib/auth-state";
import { onSyncChange, startAutoSync } from "@/lib/sync";

// Mantem o splash nativo visivel ate auth resolver. Sem isso, app
// renderiza brevemente a tela errada antes do redirect.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Instala handler global que captura crashes nao tratados (ErrorUtils).
// Salva em AsyncStorage e tenta enviar quando user logar.
instalarHandlersGlobais();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 60_000 },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(getAuthState() !== null);
  const [, setVersion] = useState(0);
  const segments = useSegments();
  const loggedIn = getAuthState() === true;
  const onLogin = segments[0] === "login";

  // Boot: lê tokens do SecureStore uma vez e atualiza o store.
  useEffect(() => {
    if (getAuthState() !== null) {
      setReady(true);
      return;
    }
    let alive = true;
    loadTokens()
      .then((t) => {
        if (!alive) return;
        setAuthState(!!t?.accessToken);
        setReady(true);
      })
      .catch(() => {
        if (!alive) return;
        setAuthState(false);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Re-renderiza ao mudar o estado de auth (login/logout disparam setAuthState).
  useEffect(() => subscribeAuth(() => setVersion((v) => v + 1)), []);

  // Inicia listeners de sync (online + visibility + intervalo) uma vez.
  useEffect(() => {
    if (loggedIn) startAutoSync();
  }, [loggedIn]);

  // Quando logar, tenta enviar erros que ficaram pendentes localmente
  // (capturados antes do login ou quando estava offline).
  useEffect(() => {
    if (loggedIn) void enviarPendentes();
  }, [loggedIn]);

  // Quando o sync completa um item (viagem ou pedágio), invalida as queries
  // do TanStack Query pra UI puxar os dados atualizados do servidor sem
  // motorista precisar de pull-to-refresh.
  useEffect(() => {
    return onSyncChange(() => {
      void queryClient.invalidateQueries({ queryKey: ["viagens"] });
      void queryClient.invalidateQueries({ queryKey: ["viagens-filtradas"] });
      void queryClient.invalidateQueries({ queryKey: ["pedagios"] });
      void queryClient.invalidateQueries({ queryKey: ["pedagios-filtrados"] });
      void queryClient.invalidateQueries({ queryKey: ["resumo-mes"] });
    });
  }, []);

  // Registra o tracking task + watchdog + handler de toque em notificação.
  // TUDO via lazy imports — top-level import de native libs aqui quebra
  // o boot do expo-router ("Objects are not valid as a React child").
  useEffect(() => {
    if (!loggedIn) return;
    let alive = true;
    let sub: { remove: () => void } | null = null;

    void (async () => {
      try {
        const { registerTrackingTask } = await import("@/lib/tracking-task");
        await registerTrackingTask();

        const { registrarWatchdog } = await import("@/lib/tracking-watchdog");
        await registrarWatchdog();

        const Notifications = await import("expo-notifications");
        if (!alive) return;
        sub = Notifications.addNotificationResponseReceivedListener((resp) => {
          const kind = resp.notification.request.content.data?.kind;
          if (kind === "auto-finalizar") {
            router.push("/viagem-andamento");
          } else if (kind === "iniciar-tracking") {
            router.push("/");
          }
        });
      } catch {
        /* expo-notifications/task-manager indisponivel — ok em dev */
      }
    })();

    return () => {
      alive = false;
      sub?.remove();
    };
  }, [loggedIn]);

  // Esconde o splash so depois de ready (proxima tela ja decidida).
  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Splash nativo cobre enquanto !ready
  if (!ready) return null;

  // Redirect declarativo (preferido vs router.replace imperativo).
  // Evita double-mount da rota destino.
  if (!loggedIn && !onLogin) return <Redirect href="/login" />;
  if (loggedIn && onLogin) return <Redirect href="/" />;

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <ErrorBoundary>
            <AuthGate>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: "white" },
                }}
              />
            </AuthGate>
          </ErrorBoundary>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
