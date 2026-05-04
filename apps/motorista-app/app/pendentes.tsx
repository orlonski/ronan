import { useMemo } from "react";
import { Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { CloudOff, Trash2 } from "lucide-react-native";
import { Alert, FlatList, Text, View } from "react-native";
import { Swipeable, GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type PendingViagem } from "@/db/database";
import { usePendingViagens } from "@/hooks/use-pending-viagens";
import { descartarViagemPendente, drain } from "@/lib/sync";
import { useCatalogos } from "@/lib/queries";

export default function Pendentes() {
  const lista = usePendingViagens();
  const cat = useCatalogos();

  // Helpers de lookup por id no catalogo
  const lookups = useMemo(() => {
    if (!cat.data) return null;
    const v = new Map(cat.data.veiculos.map((x) => [x.id, x]));
    const o = new Map(cat.data.obras.map((x) => [x.id, x]));
    const m = new Map(cat.data.materiais.map((x) => [x.id, x]));
    const l = new Map(cat.data.locais.map((x) => [x.id, x]));
    return { v, o, m, l };
  }, [cat.data]);

  function confirmarExcluir(item: PendingViagem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Excluir esta viagem?",
      "A viagem ainda não foi enviada. Apagar agora não pode ser desfeito.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            await descartarViagemPendente(item.clientId);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Aguardando internet" />

        <FlatList<PendingViagem>
          data={lista}
          keyExtractor={(v) => v.clientId}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          ListHeaderComponent={
            lista.length > 0 ? (
              <View className="mb-2 gap-3">
                <Text className="text-sm text-muted-foreground">
                  {lista.length} {lista.length === 1 ? "viagem" : "viagens"} aguardando
                  envio. Arraste pra esquerda pra excluir, ou toque em "Sincronizar"
                  pra tentar enviar agora.
                </Text>
                <Button onPress={() => void drain()}>Sincronizar agora</Button>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={CloudOff}
              title="Tudo sincronizado"
              description="Não tem viagens aguardando internet."
            />
          }
          renderItem={({ item }) => (
            <PendingCard item={item} lookups={lookups} onExcluir={confirmarExcluir} />
          )}
        />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

type Lookups = {
  v: Map<string, { id: string; placa: string; modelo: string | null }>;
  o: Map<string, { id: string; nome: string }>;
  m: Map<string, { id: string; nome: string }>;
  l: Map<string, { id: string; nome: string; cidade: string; uf: string }>;
} | null;

function PendingCard({
  item,
  lookups,
  onExcluir,
}: {
  item: PendingViagem;
  lookups: Lookups;
  onExcluir: (item: PendingViagem) => void;
}) {
  const p = item.payload as Record<string, string | number | undefined>;
  const placa = lookups?.v.get(String(p.veiculoId))?.placa;
  const obra = lookups?.o.get(String(p.obraId))?.nome;
  const material = lookups?.m.get(String(p.materialId))?.nome;
  const carga = lookups?.l.get(String(p.localCargaId))?.nome;
  const descarga = lookups?.l.get(String(p.localDescargaId))?.nome;
  const data = String(p.data ?? "");

  return (
    <Swipeable
      renderRightActions={() => (
        <View className="ml-2 flex-row items-stretch">
          <Button
            variant="destructive"
            className="h-full w-24 rounded-2xl"
            onPress={() => onExcluir(item)}
          >
            <Trash2 size={22} color="white" />
          </Button>
        </View>
      )}
      overshootRight={false}
    >
      <View className="rounded-2xl border-2 border-border bg-card p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="text-lg font-bold text-foreground" numberOfLines={1}>
              {obra ?? "Obra ?"}
            </Text>
            <Text
              className="mt-0.5 text-base font-medium text-muted-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {fmtData(data)}{placa ? ` · ${placa}` : ""}
            </Text>
          </View>
          <Badge
            variant={item.status === "error" ? "destructive" : "warning"}
          >
            {item.status === "error"
              ? `Falhou (${item.attempts})`
              : "Pendente"}
          </Badge>
        </View>

        <Text className="mt-2 text-sm text-muted-foreground" numberOfLines={1}>
          {material} · ticket {String(p.ticket ?? "")} · {String(p.toneladas ?? "")} t
        </Text>
        {(carga || descarga) && (
          <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={2}>
            {carga ?? "carga ?"} → {descarga ?? "descarga ?"}
          </Text>
        )}
        {item.status === "error" && item.errorMsg && (
          <Text className="mt-2 text-xs text-destructive" numberOfLines={2}>
            Último erro: {item.errorMsg}
          </Text>
        )}
      </View>
    </Swipeable>
  );
}

function fmtData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}
