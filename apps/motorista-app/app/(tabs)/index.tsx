import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Updates from "expo-updates";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CloudOff,
  Fuel,
  MapPin,
  Play,
  Plus,
  Receipt,
  RotateCw,
  Route,
  Scale,
  Trash2,
  Truck,
  WifiOff,
} from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { CoachTarget } from "@/components/coach-target";
import { AnuncioIniciarViagem } from "@/components/anuncio-iniciar-viagem";
import { EmptyState } from "@/components/empty-state";
import { NotificationBell } from "@/components/notification-bell";
import { ViagemCardSkeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePending } from "@/hooks/use-pending";
import { usePosicaoConfig } from "@/lib/queries";
import { showAlert, showConfirm } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import {
  TRACKING_CONFIG_DEFAULTS,
  useExcluirViagem,
  useMe,
  useResumoMes,
  useTrackingConfig,
  useViagens,
  useViagensAguardandoPeso,
  type Viagem,
} from "@/lib/queries";
import { iniciarTracking, useViagemAndamento } from "@/lib/tracking";
import { getLifecycleLocal, hidratarViagemDoServidor } from "@/lib/lifecycle";
import { startHomeTutorialIfNeeded } from "@/lib/home-tutorial";

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  ENVIADA: "warning",
  OK: "success",
  EM_CONFERENCIA: "warning",
  DIVERGENTE: "destructive",
  AJUSTADA: "secondary",
  AGUARDANDO_PESO: "warning",
};

const statusLabel: Record<string, string> = {
  ENVIADA: "Enviada",
  OK: "Conferida",
  EM_CONFERENCIA: "Conferindo",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
  AGUARDANDO_PESO: "Aguardando peso",
};

export default function Home() {
  const me = useMe();
  const viagens = useViagens();
  const resumo = useResumoMes();
  const pending = usePending();
  const aguardandoPeso = useViagensAguardandoPeso();
  const nAguardandoPeso = aguardandoPeso.data?.length ?? 0;
  const posicaoConfig = usePosicaoConfig();
  const excluir = useExcluirViagem();
  const updates = Updates.useUpdates();
  const updateReady = updates.isUpdatePending || updates.isUpdateAvailable;
  const tracking = useViagemAndamento(true);
  const trackingCfg = useTrackingConfig();

  // Lifecycle guiado: existe viagem em andamento no espelho local? Reavalia
  // sempre que a Home ganha foco (após iniciar/finalizar/descartar) pra o
  // banner "Retomar" e o botão "Iniciar viagem" aparecerem/sumirem certo.
  const [temLifecycle, setTemLifecycle] = useState<boolean | null>(null);
  const podeLifecycle = me.data?.podeViagemLifecycle ?? false;
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      // Com a flag ligada, reconcilia com o servidor (pega viagem órfã). Sem a
      // flag, só checa o espelho local (barato).
      const p = podeLifecycle ? hidratarViagemDoServidor() : getLifecycleLocal();
      void p.then((atual) => {
        if (alive) setTemLifecycle(!!atual);
      });
      return () => {
        alive = false;
      };
    }, [podeLifecycle]),
  );

  // Tutorial de primeiro uso: dispara assim que o perfil carrega (precisamos
  // das permissões pra saber quais botões existem). Só uma vez por sessão;
  // o próprio tutorial-state checa em AsyncStorage se já foi visto.
  const tutorialDisparado = useRef(false);
  useEffect(() => {
    if (tutorialDisparado.current || !me.data) return;
    tutorialDisparado.current = true;
    startHomeTutorialIfNeeded(me.data);
  }, [me.data]);

  async function iniciarViagem() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const cfg = trackingCfg.data ?? TRACKING_CONFIG_DEFAULTS;
      const ok = await iniciarTracking({
        distanciaMinMetros: cfg.distanciaMinMetros,
        intervaloMaxSegundos: cfg.intervaloMaxSegundos,
        precisaoAlta: cfg.precisaoAlta,
        accuracyMaxMetros: cfg.accuracyMaxMetros,
        velocidadeMaxKmh: cfg.velocidadeMaxKmh,
      });
      if (!ok) {
        void showAlert({
          title: "Permissão negada",
          message:
            "Pra rastrear o trajeto, precisamos da sua localização o tempo todo.",
          variant: "warning",
        });
        return;
      }
      router.push("/viagem-andamento");
    } catch (err) {
      void showAlert({
        title: "Erro",
        message: (err as Error).message ?? "Falha ao iniciar.",
        variant: "destructive",
      });
    }
  }

  async function confirmarExcluir(v: Viagem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await showConfirm({
      title: "Excluir esta viagem?",
      message: `Apagar viagem ticket ${v.ticket}? Isso só pode ser feito enquanto a operadora não conferiu.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await excluir.mutateAsync(v.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void showAlert({
        title: "Não foi possível excluir",
        message: humanizeApiError(err),
        variant: "destructive",
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function aplicarUpdate() {
    try {
      if (!updates.isUpdatePending) {
        await Updates.fetchUpdateAsync();
      }
      await Updates.reloadAsync();
    } catch (err) {
      void showAlert({
        title: "Erro",
        message: (err as Error).message ?? "Falha ao atualizar.",
        variant: "destructive",
      });
    }
  }

  async function checarUpdate() {
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
      }
    } catch {
      /* silencioso — pode estar offline */
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <AnuncioIniciarViagem podeLifecycle={podeLifecycle} />
      {/* Header brand: status bar + nome motorista + sino de notificações */}
      <View className="bg-brand">
        <View className="flex-row items-start justify-between gap-3 px-5 pb-6 pt-14">
          <View className="flex-1">
            <Text className="text-xs font-semibold uppercase tracking-wider text-white/70">
              Motorista
            </Text>
            {me.isLoading && <ActivityIndicator color="white" className="mt-2" />}
            {me.data && (
              <>
                <Text className="mt-0.5 text-2xl font-bold text-white">
                  {me.data.nome}
                </Text>
                {me.data.veiculoDefault && (
                  <Text
                    className="mt-0.5 text-base font-medium text-white/80"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    Placa {me.data.veiculoDefault.placa}
                  </Text>
                )}
              </>
            )}
            {me.error && (
              <Text className="mt-1 text-sm text-white/80">
                Perfil indisponível offline
              </Text>
            )}
          </View>
          <CoachTarget id="coach-sino" className="rounded-full">
            <NotificationBell />
          </CoachTarget>
        </View>
      </View>

      <FlatList<Viagem>
        data={viagens.data ?? []}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={viagens.isFetching && !viagens.isLoading}
            onRefresh={() => {
              void me.refetch();
              void viagens.refetch();
              void resumo.refetch();
              void checarUpdate();
            }}
          />
        }
        ListHeaderComponent={
          <View className="mb-3 gap-3">
            {/* Banner viagem em andamento (tracking ativo) */}
            {tracking.data && (
              <Pressable
                onPress={() => router.push("/viagem-andamento")}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-primary bg-primary/15 p-4 active:opacity-75"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-primary">
                  <Activity size={22} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    Viagem em andamento
                  </Text>
                  <Text
                    className="text-sm text-muted-foreground"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {tracking.resumo?.kmReal.toFixed(1) ?? "0,0"} km · toque pra ver
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Banner: retomar viagem guiada (lifecycle) em andamento.
                Aparece só quando há viagem no espelho local. Substitui o
                botão "Iniciar viagem" enquanto uma está aberta. */}
            {me.data?.podeViagemLifecycle && temLifecycle && (
              <Pressable
                onPress={() => router.push("/viagem-guiada")}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-primary bg-primary/15 p-4 active:opacity-75"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-primary">
                  <Route size={22} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    Retomar viagem em andamento
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Toque pra continuar de onde parou
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Banner: convite pra ativar compartilhamento de posição.
                Aparece enquanto config.ativada=false. Some assim que
                motorista ativa em /perfil-posicao. */}
            {posicaoConfig.data && !posicaoConfig.data.ativada && (
              <Pressable
                onPress={() => router.push("/perfil-posicao")}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-brand/30 bg-brand/10 p-4 active:opacity-75"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-brand">
                  <MapPin size={22} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    Compartilhar sua posição
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Ajuda quando cliente liga perguntando onde tá o material
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Banner de update OTA disponível */}
            {updateReady && (
              <Pressable
                onPress={aplicarUpdate}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-primary/40 bg-primary/15 p-4 active:opacity-75"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-primary">
                  <RotateCw size={22} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    Nova versão disponível
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Toque aqui pra atualizar agora
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Banner: itens com erro permanente (4xx, motorista precisa
                editar/descartar). Vermelho — exige ação. */}
            {pending.comErro > 0 && (
              <Pressable
                onPress={() => router.push("/pendentes")}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-destructive/40 bg-destructive/10 p-4 active:opacity-75"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-destructive">
                  <AlertTriangle size={22} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    {pending.comErro} com erro
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Toque pra revisar e descartar
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Banner: itens só aguardando sincronizar (sem erro). Amarelo — informativo.
                Inclui abastecimentos (antes só contava viagens+pedágios, e o
                abastecimento sumia dessa conta). */}
            {Math.max(
              0,
              pending.viagens + pending.pedagios + pending.abastecimentos + pending.lifecycle - pending.comErro,
            ) > 0 && (
              <Pressable
                onPress={() => router.push("/pendentes")}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-warning/30 bg-warning/15 p-4 active:opacity-75"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-warning">
                  <CloudOff size={22} color="#0f172a" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    {Math.max(
                      0,
                      pending.viagens + pending.pedagios + pending.abastecimentos + pending.lifecycle - pending.comErro,
                    )}{" "}
                    aguardando sincronizar
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Toque pra ver e gerenciar
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Banner: viagens lançadas sem peso, esperando o romaneio. Âmbar,
                persistente enquanto houver pendência — o motorista completa o
                peso/ticket quando o romaneio sair no fim do dia. */}
            {nAguardandoPeso > 0 && (
              <Pressable
                onPress={() => router.push("/aguardando-peso")}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-amber-500/40 bg-amber-500/15 p-4 active:opacity-75"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-amber-500">
                  <Scale size={22} color="#0f172a" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    {nAguardandoPeso === 1
                      ? "1 viagem esperando o peso"
                      : `${nAguardandoPeso} viagens esperando o peso`}
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Toque pra completar o peso e o romaneio
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Botão Hero "Iniciar viagem" (lifecycle guiado, NOVO). É o
                destaque e vem primeiro. Escondido enquanto há viagem em
                andamento (o banner "Retomar" cobre). */}
            {me.data?.podeViagemLifecycle && temLifecycle === false && (
              <Pressable
                onPress={() => router.push("/iniciar-viagem")}
                className="overflow-hidden rounded-2xl bg-primary active:opacity-85"
              >
                <View className="flex-row items-center gap-4 p-5">
                  <View className="h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
                    <Route size={32} color="white" strokeWidth={2.5} />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-2xl font-extrabold text-primary-foreground">
                        Iniciar viagem
                      </Text>
                      <Badge variant="success">Novo</Badge>
                    </View>
                    <Text className="mt-0.5 text-base font-medium text-primary-foreground/85">
                      O app te guia: carga → descarga → fim
                    </Text>
                  </View>
                  <Play size={26} color="white" strokeWidth={2.5} fill="white" />
                </View>
              </Pressable>
            )}

            {/* "Nova viagem": herói quando é o único fluxo; rebaixado a
                secundário quando o motorista já tem o "Iniciar viagem" novo
                (sinaliza que vai sair em breve). */}
            {me.data?.podeLancarViagem && (
              <CoachTarget id="coach-nova-viagem" className="rounded-2xl">
              {podeLifecycle ? (
                <Pressable
                  onPress={() => router.push("/nova-viagem")}
                  className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
                >
                  <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
                    <Truck size={26} color="#13316b" strokeWidth={2.5} />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-lg font-bold text-foreground">
                        Nova viagem
                      </Text>
                      <Badge variant="warning">Sai em breve</Badge>
                    </View>
                    <Text className="text-sm text-muted-foreground">
                      Jeito antigo de lançar — vai sair em breve
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => router.push("/nova-viagem")}
                  className="overflow-hidden rounded-2xl bg-primary active:opacity-85"
                >
                  <View className="flex-row items-center gap-4 p-5">
                    <View className="h-16 w-16 items-center justify-center rounded-2xl bg-white/20">
                      <Truck size={32} color="white" strokeWidth={2.5} />
                    </View>
                    <View className="flex-1">
                      <Text className="text-2xl font-extrabold text-primary-foreground">
                        Nova viagem
                      </Text>
                      <Text className="mt-0.5 text-base font-medium text-primary-foreground/85">
                        Lançar carga, descarga e foto
                      </Text>
                    </View>
                    <Plus size={28} color="white" strokeWidth={2.5} />
                  </View>
                </Pressable>
              )}
              </CoachTarget>
            )}

            {/* Botão Iniciar viagem (tracking GPS) */}
            {me.data?.podeIniciarViagem && (
              <CoachTarget id="coach-iniciar-viagem" className="rounded-2xl">
              <Pressable
                onPress={iniciarViagem}
                className="flex-row items-center gap-4 rounded-2xl border-2 border-primary bg-card p-4 active:opacity-75"
              >
                <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary">
                  <Play size={26} color="white" strokeWidth={2.5} />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-foreground">
                    Iniciar viagem com GPS
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    {tracking.data
                      ? `Em andamento · ${tracking.resumo?.kmReal.toFixed(1) ?? "0"} km`
                      : "Rastreia o trajeto e calcula KM real"}
                  </Text>
                </View>
              </Pressable>
              </CoachTarget>
            )}

            {/* Botão Pedágio */}
            {me.data?.podeLancarPedagio && (
              <CoachTarget id="coach-pedagio" className="rounded-2xl">
              <Pressable
                onPress={() => router.push("/novo-pedagio")}
                className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
              >
                <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
                  <Receipt size={26} color="#13316b" strokeWidth={2.5} />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-foreground">
                    Pedágio
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Registrar passagem em praça
                  </Text>
                </View>
              </Pressable>
              </CoachTarget>
            )}

            {/* Botão Abastecimento */}
            {me.data?.podeLancarAbastecimento && (
              <CoachTarget id="coach-abastecimento" className="rounded-2xl">
              <Pressable
                onPress={() => router.push("/novo-abastecimento")}
                className="flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
              >
                <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
                  <Fuel size={26} color="#13316b" strokeWidth={2.5} />
                </View>
                <View className="flex-1">
                  <Text className="text-lg font-bold text-foreground">
                    Abastecimento
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Registrar combustível e odômetro
                  </Text>
                </View>
              </Pressable>
              </CoachTarget>
            )}

            {/* Empty state se todas as 4 funcionalidades estão desabilitadas */}
            {me.data &&
              !me.data.podeLancarViagem &&
              !me.data.podeIniciarViagem &&
              !me.data.podeLancarPedagio &&
              !me.data.podeLancarAbastecimento && (
                <View className="items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card p-6">
                  <Text className="text-center text-base font-semibold text-foreground">
                    Nenhuma funcionalidade liberada agora
                  </Text>
                  <Text className="text-center text-sm text-muted-foreground">
                    Fale com o escritório pra liberar lançamentos no app.
                  </Text>
                </View>
              )}

            {/* Resumo do mes corrente — bate com pagamento */}
            {resumo.data && resumo.data.totalViagens > 0 && (
              <View className="mt-3 rounded-2xl border-2 border-border bg-card p-4">
                <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Resumo de {fmtMesLongo(resumo.data.mes)}
                </Text>
                <View className="mt-3 flex-row gap-6">
                  <ResumoStat label="viagens" value={String(resumo.data.totalViagens)} />
                  <ResumoStat label="t" value={fmtNum(resumo.data.totalToneladas, 1)} />
                  <ResumoStat label="km" value={fmtNum(resumo.data.totalKm, 0)} />
                </View>
                {resumo.data.pedagios.count > 0 && (
                  <View className="mt-3 flex-row gap-6 border-t-2 border-border pt-3">
                    <ResumoStat
                      label="pedágios"
                      value={String(resumo.data.pedagios.count)}
                    />
                    <ResumoStat
                      label="total"
                      value={`R$ ${fmtNum(resumo.data.pedagios.totalValor, 2)}`}
                    />
                  </View>
                )}
              </View>
            )}

            <Text className="mt-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Suas viagens recentes
            </Text>
          </View>
        }
        ListFooterComponent={
          (viagens.data?.length ?? 0) > 0 ? (
            <Pressable
              onPress={() => router.push("/historico")}
              className="mt-2 flex-row items-center justify-center gap-2 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
            >
              <Text className="text-base font-bold text-foreground">
                Ver tudo
              </Text>
              <ArrowRight size={18} color="#0f172a" />
            </Pressable>
          ) : null
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 30).duration(220)}>
            <ViagemCard v={item} onExcluir={() => confirmarExcluir(item)} />
          </Animated.View>
        )}
        ListEmptyComponent={
          viagens.isLoading ? (
            <View className="gap-3">
              <ViagemCardSkeleton />
              <ViagemCardSkeleton />
              <ViagemCardSkeleton />
            </View>
          ) : viagens.error ? (
            <EmptyState
              icon={WifiOff}
              title="Sem viagens disponíveis"
              description="Sem internet e sem viagens em cache."
              iconColor="#dc2626"
            />
          ) : (
            <EmptyState
              icon={Truck}
              title="Nenhuma viagem ainda"
              description='Toque em "Nova viagem" pra começar.'
            />
          )
        }
      />
    </SafeAreaView>
  );
}

function ViagemCard({ v, onExcluir }: { v: Viagem; onExcluir: () => void }) {
  const variant = statusVariant[v.status] ?? "outline";
  const label = statusLabel[v.status] ?? v.status;
  const podeExcluir = v.status === "ENVIADA";
  const aguardandoPeso = v.status === "AGUARDANDO_PESO";
  // Arrastar pra revelar "excluir" fazia o toque de soltar navegar pro detalhe
  // (RN Pressable dentro do Swipeable dispara onPress no fim do gesto). Marcamos
  // quando o swipe abre/mexe e engolimos esse 1º toque.
  const swipedRef = useRef(false);

  const card = (
    <Pressable
      onPress={() => {
        if (swipedRef.current) {
          swipedRef.current = false;
          return;
        }
        router.push(`/viagens/${v.id}`);
      }}
      className="rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground" numberOfLines={1}>
            {v.cliente.nome}
          </Text>
          <Text
            className="mt-0.5 text-base font-medium text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {fmtData(v.data)} · {v.veiculo.placa}
          </Text>
          <Text
            className="mt-0.5 text-xs text-muted-foreground/80"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            Cadastrada {fmtDataHoraCurta(v.sincronizadoEm)}
          </Text>
        </View>
        <Badge variant={variant}>{label}</Badge>
      </View>

      <View className="mt-3 gap-1.5">
        <View className="flex-row items-center gap-2">
          <ArrowUp size={16} color="#16a34a" />
          <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>
            {v.localCarga.nome}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <ArrowDown size={16} color="#dc2626" />
          <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>
            {v.localDescarga.nome}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row gap-5 border-t-2 border-border pt-3">
        <Stat
          label="t"
          value={aguardandoPeso ? "—" : fmtNum(v.toneladasEfetiva, 3)}
          subValue={
            aguardandoPeso
              ? "aguardando"
              : v.toneladasAjustada
                ? `(${fmtNum(v.toneladasInformada, 3)})`
                : undefined
          }
        />
        <Stat
          label="km"
          value={fmtNum(v.kmEfetivo, 2)}
          subValue={v.kmAjustada ? `(${fmtNum(v.kmInformado, 2)})` : undefined}
        />
        <Stat label="ticket" value={aguardandoPeso ? "—" : v.ticket} />
      </View>
    </Pressable>
  );

  if (!podeExcluir) return card;

  return (
    <Swipeable
      friction={2}
      rightThreshold={40}
      onSwipeableWillOpen={() => {
        swipedRef.current = true;
      }}
      onSwipeableWillClose={() => {
        // Fechou por gesto: também segura o toque de soltar pra não navegar.
        swipedRef.current = true;
      }}
      renderRightActions={() => (
        <View className="ml-2 flex-row items-stretch">
          <Button
            variant="destructive"
            className="h-full w-24 rounded-2xl"
            onPress={onExcluir}
          >
            <Trash2 size={22} color="white" />
          </Button>
        </View>
      )}
      overshootRight={false}
    >
      {card}
    </Swipeable>
  );
}

function Stat({
  label,
  value,
  subValue,
}: {
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <View>
      <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Text
        className="text-lg font-bold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
      {subValue && (
        <Text className="text-[10px] text-muted-foreground">{subValue}</Text>
      )}
    </View>
  );
}

function ResumoStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Text
        className="text-2xl font-extrabold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}

const MESES_LONGO = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function fmtMesLongo(mes: string): string {
  const [ano, m] = mes.split("-");
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return mes;
  return `${MESES_LONGO[idx]}/${ano.slice(2)}`;
}

function fmtData(iso: string): string {
  // Parse manual pra evitar timezone shift (UTC-3 retorna dia anterior).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

function fmtDataHoraCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes} ${hh}:${mm}`;
}

function fmtNum(v: string, casas: number): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
