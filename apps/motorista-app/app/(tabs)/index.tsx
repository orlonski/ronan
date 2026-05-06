import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Updates from "expo-updates";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CloudOff,
  Play,
  Plus,
  Receipt,
  RotateCw,
  Trash2,
  Truck,
  WifiOff,
} from "lucide-react-native";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/empty-state";
import { ViagemCardSkeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePending } from "@/hooks/use-pending";
import { humanizeApiError } from "@/lib/api";
import {
  TRACKING_CONFIG_DEFAULTS,
  useExcluirViagem,
  useMe,
  useResumoMes,
  useTrackingConfig,
  useViagens,
  type Viagem,
} from "@/lib/queries";
import { iniciarTracking, useViagemAndamento } from "@/lib/tracking";

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  ENVIADA: "warning",
  OK: "success",
  EM_CONFERENCIA: "warning",
  DIVERGENTE: "destructive",
  AJUSTADA: "secondary",
};

const statusLabel: Record<string, string> = {
  ENVIADA: "Enviada",
  OK: "Conferida",
  EM_CONFERENCIA: "Conferindo",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
};

export default function Home() {
  const me = useMe();
  const viagens = useViagens();
  const resumo = useResumoMes();
  const pending = usePending();
  const excluir = useExcluirViagem();
  const updates = Updates.useUpdates();
  const updateReady = updates.isUpdatePending || updates.isUpdateAvailable;
  const tracking = useViagemAndamento(true);
  const trackingCfg = useTrackingConfig();

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
        Alert.alert(
          "Permissão negada",
          "Pra rastrear o trajeto, precisamos da sua localização o tempo todo.",
        );
        return;
      }
      router.push("/viagem-andamento");
    } catch (err) {
      Alert.alert("Erro", (err as Error).message ?? "Falha ao iniciar.");
    }
  }

  function confirmarExcluir(v: Viagem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Excluir esta viagem?",
      `Apagar viagem ticket ${v.ticket}?\nIsso só pode ser feito enquanto a operadora não conferiu.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            try {
              await excluir.mutateAsync(v.id);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err) {
              Alert.alert("Não foi possível excluir", humanizeApiError(err));
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            }
          },
        },
      ],
    );
  }

  async function aplicarUpdate() {
    try {
      if (!updates.isUpdatePending) {
        await Updates.fetchUpdateAsync();
      }
      await Updates.reloadAsync();
    } catch (err) {
      Alert.alert("Erro", (err as Error).message ?? "Falha ao atualizar.");
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
      {/* Header brand: status bar + nome motorista */}
      <View className="bg-brand">
        <View className="px-5 pb-6 pt-14">
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

            {/* Banner pendentes — toca pra ver lista + excluir/sincronizar */}
            {(pending.viagens > 0 || pending.pedagios > 0) && (
              <Pressable
                onPress={() => router.push("/pendentes")}
                className="flex-row items-center gap-3 rounded-2xl border-2 border-warning/30 bg-warning/15 p-4 active:opacity-75"
              >
                <View className="h-12 w-12 items-center justify-center rounded-full bg-warning">
                  <CloudOff size={22} color="#0f172a" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-bold text-foreground">
                    {pending.viagens + pending.pedagios} aguardando internet
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    Toque pra ver e gerenciar
                  </Text>
                </View>
              </Pressable>
            )}

            {/* Botão Hero "Nova viagem" */}
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

            {/* Botão Iniciar viagem (tracking GPS) */}
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

            {/* Botão Pedágio */}
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

  const card = (
    <Pressable
      onPress={() => router.push(`/viagens/${v.id}`)}
      className="rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground" numberOfLines={1}>
            {v.obra.nome}
          </Text>
          <Text
            className="mt-0.5 text-base font-medium text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {fmtData(v.data)} · {v.veiculo.placa}
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
        <Stat label="t" value={fmtNum(v.toneladas, 3)} />
        <Stat label="km" value={fmtNum(v.km, 2)} />
        <Stat label="ticket" value={v.ticket} />
      </View>
    </Pressable>
  );

  if (!podeExcluir) return card;

  return (
    <Swipeable
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

function Stat({ label, value }: { label: string; value: string }) {
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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

function fmtNum(v: string, casas: number): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
