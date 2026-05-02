import { router } from "expo-router";
import { ArrowDown, ArrowUp, LogOut } from "lucide-react-native";
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
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { useMe, useViagens, type Viagem } from "@/lib/queries";

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  ENVIADA: "secondary",
  OK: "default",
  EM_CONFERENCIA: "secondary",
  DIVERGENTE: "destructive",
  AJUSTADA: "outline",
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

  async function sair() {
    await clearTokens();
    setAuthState(false);
    router.replace("/login");
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <FlatList<Viagem>
        data={viagens.data ?? []}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 8 }}
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
          <View className="mb-4 gap-4">
            <View className="flex-row items-start justify-between">
              <View className="flex-1">
                <Text className="text-xs uppercase tracking-wide text-muted-foreground">
                  Motorista
                </Text>
                {me.isLoading && <ActivityIndicator className="mt-1" />}
                {me.data && (
                  <>
                    <Text className="mt-0.5 text-xl font-semibold text-foreground">
                      {me.data.nome}
                    </Text>
                    {me.data.veiculoDefault && (
                      <Text className="text-sm text-muted-foreground">
                        Placa padrão {me.data.veiculoDefault.placa}
                      </Text>
                    )}
                  </>
                )}
                {me.error && (
                  <Text className="mt-1 text-sm text-destructive">
                    Perfil indisponível offline
                  </Text>
                )}
              </View>
              <Button variant="ghost" size="icon" onPress={sair}>
                <LogOut size={20} color="#0f172a" />
              </Button>
            </View>

            <View className="flex-row gap-2">
              <Button
                size="lg"
                className="flex-1"
                onPress={() => router.push("/nova-viagem")}
              >
                Nova viagem
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="flex-1"
                onPress={() => router.push("/novo-pedagio")}
              >
                Pedágio
              </Button>
            </View>

            <Text className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
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
    <View className="rounded-lg border border-border bg-card p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="text-sm font-medium text-foreground">{v.obra.nome}</Text>
          <Text className="text-xs text-muted-foreground">
            {v.material.nome} · {fmtData(v.data)} · placa {v.veiculo.placa}
          </Text>
        </View>
        <Badge variant={variant}>{label}</Badge>
      </View>

      <View className="mt-3 gap-1">
        <View className="flex-row items-center gap-1.5">
          <ArrowUp size={12} color="#64748b" />
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {v.localCarga.nome} · {v.localCarga.cidade}/{v.localCarga.uf}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <ArrowDown size={12} color="#64748b" />
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {v.localDescarga.nome} · {v.localDescarga.cidade}/{v.localDescarga.uf}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row gap-4">
        <Text className="text-xs text-muted-foreground">
          <Text className="font-medium text-foreground">{fmtNum(v.toneladas, 3)}</Text> t
        </Text>
        <Text className="text-xs text-muted-foreground">
          <Text className="font-medium text-foreground">{fmtNum(v.km, 2)}</Text> km
        </Text>
        <Text className="text-xs text-muted-foreground">
          ticket{" "}
          <Text className="font-medium text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
            {v.ticket}
          </Text>
        </Text>
      </View>
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
