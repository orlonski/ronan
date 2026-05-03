import { router } from "expo-router";
import { ArrowDown, ArrowUp, User } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
            }}
          />
        }
        ListHeaderComponent={
          <View className="mb-3 gap-3">
            <Button
              size="lg"
              className="h-20"
              onPress={() => router.push("/nova-viagem")}
            >
              <Text className="text-xl font-bold text-primary-foreground">
                + Nova viagem
              </Text>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-16"
              onPress={() => router.push("/novo-pedagio")}
            >
              <Text className="text-lg font-bold text-foreground">
                Pedágio
              </Text>
            </Button>
            <Text className="mt-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Últimas viagens
            </Text>
          </View>
        }
        renderItem={({ item }) => <ViagemCard v={item} />}
        ListEmptyComponent={
          <View className="items-center py-12">
            {viagens.isLoading ? (
              <ActivityIndicator />
            ) : viagens.error ? (
              <Text className="text-sm text-destructive">
                Sem internet e sem viagens em cache.
              </Text>
            ) : (
              <Text className="text-sm text-muted-foreground">
                Nenhuma viagem ainda.
              </Text>
            )}
          </View>
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
