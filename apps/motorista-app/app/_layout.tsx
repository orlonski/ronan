import "../global.css";

import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, router, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/error-boundary";
import { AlertHost } from "@/components/ui/alert-dialog";
import { TutorialHost } from "@/components/tutorial-host";
import { ConnectivityBanner } from "@/components/connectivity-banner";
import { TelaCarregando } from "@/components/tela-carregando";
import { aplicarUpdateNoBoot } from "@/lib/ota";
import { loadTokens } from "@/lib/auth";
import {
  getCadastroStatus,
  loadCadastroStatus,
  subscribeCadastroStatus,
} from "@/lib/cadastro-status";
import { EmAnalise } from "@/components/em-analise";
import NetInfo from "@react-native-community/netinfo";
import { drenar as drenarEventos } from "@/lib/event-reporter";
import { prefetchDadosBase, setQueryClientGlobal } from "@/lib/queries";
import { pruneExpired as pruneRotaCache } from "@/lib/rota-cache";
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

// AppState → focusManager: quando o app volta pra foreground, TanStack Query
// trata como "window focus" e refetcha queries stale automaticamente. Cobre o
// caso "user abre app depois de push" mesmo se addNotificationReceivedListener
// não disparou. Module-level — registra uma vez no JS bundle, vive enquanto
// o processo existe.
AppState.addEventListener("change", (status) => {
  focusManager.setFocused(status === "active");
});

// Instala handler global que captura crashes nao tratados (ErrorUtils).
// Salva em AsyncStorage e tenta enviar quando user logar.
instalarHandlersGlobais();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 60_000 },
  },
});

// Permite o useCalcularRota fora-de-hook (queryFn) ler cache de catalogos
// pra calcular fallback haversine quando offline.
setQueryClientGlobal(queryClient);

// Prune entradas expiradas do cache local de rotas no boot.
void pruneRotaCache();

function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(getAuthState() !== null);
  const [, setVersion] = useState(0);
  const segments = useSegments();
  const loggedIn = getAuthState() === true;
  // Rotas públicas (pré-login): login, auto-cadastro (signup*) e recuperação de
  // senha (esqueci-senha*) — todas começam com esses prefixos.
  const onAuthScreen =
    segments[0] === "login" ||
    (segments[0]?.startsWith("signup") ?? false) ||
    (segments[0]?.startsWith("esqueci-senha") ?? false);
  const pendenteAprovacao = getCadastroStatus() === "PENDENTE_APROVACAO";

  // Boot: lê tokens + status do SecureStore uma vez e atualiza os stores.
  useEffect(() => {
    if (getAuthState() !== null) {
      setReady(true);
      return;
    }
    let alive = true;
    Promise.all([loadTokens(), loadCadastroStatus()])
      .then(([t]) => {
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

  // Re-renderiza ao mudar auth (login/logout) ou status (aprovação).
  useEffect(() => subscribeAuth(() => setVersion((v) => v + 1)), []);
  useEffect(() => subscribeCadastroStatus(() => setVersion((v) => v + 1)), []);

  // Inicia listeners de sync (online + visibility + intervalo) uma vez.
  useEffect(() => {
    if (loggedIn) startAutoSync();
  }, [loggedIn]);

  // Baixa e persiste os dados-base (catálogos/perfil/tipos) pro uso offline
  // assim que loga/abre logado — como login exige internet, quem logou já leva
  // tudo pro mato. E rebaixa quando reconectar (logou com sinal ruim / dado
  // velho). Best-effort (não trava nada).
  useEffect(() => {
    if (!loggedIn) return;
    void prefetchDadosBase(queryClient);
    const unsub = NetInfo.addEventListener((s) => {
      if (s.isConnected) void prefetchDadosBase(queryClient);
    });
    return unsub;
  }, [loggedIn]);

  // Quando logar, tenta enviar erros que ficaram pendentes localmente
  // (capturados antes do login ou quando estava offline).
  useEffect(() => {
    if (loggedIn) void enviarPendentes();
  }, [loggedIn]);

  // Idem pra fila de eventos de telemetria — drena após login.
  useEffect(() => {
    if (loggedIn) void drenarEventos();
  }, [loggedIn]);

  // Quando o sync completa um item (viagem ou pedágio), invalida as queries
  // do TanStack Query pra UI puxar os dados atualizados do servidor sem
  // motorista precisar de pull-to-refresh.
  useEffect(() => {
    return onSyncChange(() => {
      void queryClient.invalidateQueries({ queryKey: ["viagens"] });
      void queryClient.invalidateQueries({ queryKey: ["viagens-filtradas"] });
      void queryClient.invalidateQueries({ queryKey: ["viagem-detalhe"] });
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
    let subRecv: { remove: () => void } | null = null;

    void (async () => {
      try {
        const { registerTrackingTask } = await import("@/lib/tracking-task");
        await registerTrackingTask();

        const { registrarWatchdog } = await import("@/lib/tracking-watchdog");
        await registrarWatchdog();

        // Geofence passivo: registra task + sincroniza locais em validação.
        // Roda em background sem precisar de "Iniciar viagem".
        const geofence = await import("@/lib/geofence-locais");
        await geofence.registerGeofenceTask();
        void geofence.sincronizarGeofences();
        void geofence.drenarFila();

        // Captura periódica de posição (controle de frota — opt-in).
        // Sempre registra a task; só inicia o foreground service se o
        // motorista ativou. Refetch da config + start serve pra cobrir
        // reabertura do app (task pode ter sido morta pelo SO).
        const posicao = await import("@/lib/posicao-periodica");
        await posicao.registerPosicaoTask();
        void (async () => {
          try {
            const { api } = await import("@/lib/api");
            const cfg = await api.get<{
              ativada: boolean;
              horarioInicio: number | null;
              horarioFim: number | null;
            }>("/m/posicao-config");
            await posicao.setConfigLocal(cfg);
            if (cfg.ativada) {
              const ativa = await posicao.isCapturaPeriodicaAtiva();
              if (!ativa) await posicao.iniciarCapturaPeriodica();
            } else {
              await posicao.pararCapturaPeriodica();
            }
          } catch {
            // Offline ou erro de rede — usa cache local que já está em uso.
          }
        })();

        // Push remoto: pede permissão, pega o ExpoPushToken e manda pro backend.
        // Fire-and-forget — falha silenciosa (não pode bloquear o app).
        const { obterEEnviarPushToken } = await import("@/lib/notifications");
        void obterEEnviarPushToken();

        const Notifications = await import("expo-notifications");
        if (!alive) return;

        // Listener foreground: push chegou com app aberto. Invalida a query
        // da central pra o sino atualizar o badge na hora.
        subRecv = Notifications.addNotificationReceivedListener(() => {
          void queryClient.invalidateQueries({ queryKey: ["notificacoes"] });
        });

        sub = Notifications.addNotificationResponseReceivedListener((resp) => {
          const data = resp.notification.request.content.data ?? {};
          const kind = data.kind;
          const notificacaoId = typeof data.notificacaoId === "string" ? data.notificacaoId : null;

          // Fire-and-forget: marca lida quando user toca na push do sistema.
          if (notificacaoId) {
            void (async () => {
              try {
                const { api } = await import("@/lib/api");
                await api.marcarNotificacaoLida(notificacaoId);
                void queryClient.invalidateQueries({ queryKey: ["notificacoes"] });
              } catch {
                /* offline / já lida — ignora */
              }
            })();
          }

          if (kind === "auto-finalizar") {
            router.push("/viagem-andamento");
          } else if (kind === "iniciar-tracking") {
            router.push("/");
          } else if (
            kind === "viagem-divergente" ||
            kind === "viagem-conferida" ||
            kind === "viagem-editada"
          ) {
            const viagemId = typeof data.viagemId === "string" ? data.viagemId : null;
            if (viagemId) {
              router.push(`/viagens/${viagemId}`);
            } else {
              router.push("/notificacoes");
            }
          } else if (kind === "abastecimento-editado") {
            // Não temos tela de detalhe de abastecimento no app motorista —
            // abre a central pra ver a notificação completa com o diff.
            router.push("/notificacoes");
          } else if (kind === "mensagem-admin") {
            router.push("/notificacoes");
          }
        });
      } catch {
        /* expo-notifications/task-manager indisponivel — ok em dev */
      }
    })();

    return () => {
      alive = false;
      sub?.remove();
      subRecv?.remove();
    };
  }, [loggedIn]);

  // Esconde o splash so depois de ready (proxima tela ja decidida).
  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // Enquanto a auth não resolveu: o splash nativo ainda cobre no caminho
  // normal; mas se o BootGate já escondeu o splash (passou pela tela de
  // atualização), a TelaCarregando evita um flash em branco aqui.
  if (!ready) return <TelaCarregando />;

  // Redirect declarativo (preferido vs router.replace imperativo).
  // Evita double-mount da rota destino.
  if (!loggedIn && !onAuthScreen) return <Redirect href="/login" />;
  if (loggedIn && onAuthScreen) return <Redirect href="/" />;

  // Logado mas cadastro ainda em análise: cobre o app inteiro com a tela de
  // espera (some sozinho quando o status vira APROVADO).
  if (loggedIn && pendenteAprovacao) return <EmAnalise />;

  return <>{children}</>;
}

/**
 * Roda ANTES do AuthGate, mirando o primeiro download da loja: enquanto o app
 * ainda está no bundle embutido, baixa a OTA mais recente e recarrega, pra o
 * motorista já cair na versão atual sem fechar/reabrir. Em launches seguintes
 * (já numa OTA aplicada) é no-op e libera o app na hora.
 */
function BootGate({ children }: { children: React.ReactNode }) {
  // "checking" = checando OTA (splash nativo cobre)
  // "updating" = baixando uma OTA nova (mostra TelaCarregando)
  // "done"     = segue pro app (AuthGate)
  const [phase, setPhase] = useState<"checking" | "updating" | "done">(
    Updates.isEnabled && Updates.isEmbeddedLaunch ? "checking" : "done",
  );

  useEffect(() => {
    if (phase !== "checking") return;
    let alive = true;
    void aplicarUpdateNoBoot({
      onDownloadStart: () => {
        if (alive) setPhase("updating");
      },
    }).finally(() => {
      // Só é alcançado se NÃO recarregou (sem update, timeout ou erro).
      if (alive) setPhase("done");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ao entrar em "updating", esconde o splash nativo pra revelar a TelaCarregando.
  useEffect(() => {
    if (phase === "updating") SplashScreen.hideAsync().catch(() => {});
  }, [phase]);

  if (phase === "checking") return null; // splash nativo cobre
  if (phase === "updating")
    return <TelaCarregando mensagem="Atualizando para a versão mais recente…" />;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <ErrorBoundary>
            <BootGate>
              <AuthGate>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: "white" },
                  }}
                />
              </AuthGate>
              <ConnectivityBanner />
              <TutorialHost />
              <AlertHost />
            </BootGate>
          </ErrorBoundary>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
