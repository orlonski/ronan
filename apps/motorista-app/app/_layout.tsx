import "../global.css";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { loadTokens } from "@/lib/auth";
import {
  getAuthState,
  setAuthState,
  subscribeAuth,
} from "@/lib/auth-state";
import { startAutoSync } from "@/lib/sync";

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

  // Redirect logic baseado no estado atual.
  useEffect(() => {
    if (!ready) return;
    const onLogin = segments[0] === "login";
    if (!loggedIn && !onLogin) router.replace("/login");
    else if (loggedIn && onLogin) router.replace("/");
  }, [ready, loggedIn, segments]);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <AuthGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "white" },
              }}
            />
          </AuthGate>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
