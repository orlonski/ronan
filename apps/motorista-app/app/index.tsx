import { router } from "expo-router";
import * as Updates from "expo-updates";
import {
  ArrowDown,
  ArrowUp,
  CloudOff,
  Plus,
  Receipt,
  RotateCw,
  Truck,
  User,
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
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/empty-state";
import { ViagemCardSkeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePending } from "@/hooks/use-pending";
import { useMe, useViagens, type Viagem } from "@/lib/queries";

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
  const pending = usePending();
  const updates = Updates.useUpdates();
  const updateReady = updates.isUpdatePending || updates.isUpdateAvailable;

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
        <View className="flex-row items-start justify-between px-5 pb-6 pt-14">
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
          <Button
            variant="ghost"
            size="icon"
            className="bg-white/15 active:bg-white/25"
            onPress={() => router.push("/perfil")}
          >
            <User size={26} color="white" />
          </Button>
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
              void checarUpdate();
            }}
          />
        }
        ListHeaderComponent={
          <View className="mb-3 gap-3">
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

            <Text className="mt-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Suas viagens recentes
            </Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 30).duration(220)}>
            <ViagemCard v={item} />
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

function ViagemCard({ v }: { v: Viagem }) {
  const variant = statusVariant[v.status] ?? "outline";
  const label = statusLabel[v.status] ?? v.status;
  return (
    <View className="rounded-2xl border-2 border-border bg-card p-4">
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
    </View>
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
