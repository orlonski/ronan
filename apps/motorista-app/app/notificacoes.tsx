import { router } from "expo-router";
import { Bell } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen-header";
import { ViagemCardSkeleton } from "@/components/skeleton";
import {
  useMarcarNotificacaoLida,
  useMarcarTodasNotificacoesLidas,
  useNotificacoes,
  type Notificacao,
} from "@/lib/queries";

export default function NotificacoesScreen() {
  const q = useNotificacoes();
  const marcarLida = useMarcarNotificacaoLida();
  const marcarTodas = useMarcarTodasNotificacoesLidas();

  const itens = q.data?.pages.flatMap((p) => p.itens) ?? [];
  const naoLidas = q.data?.pages[0]?.naoLidas ?? 0;

  function handleTap(n: Notificacao) {
    if (!n.lida) marcarLida.mutate(n.id);
    // Deep-link: se a notificação referencia uma viagem (kind viagem-*),
    // abre a tela de detalhe diretamente. Senão fica na central.
    const dados = n.dados ?? {};
    const viagemId = typeof dados.viagemId === "string" ? dados.viagemId : null;
    if (viagemId) {
      router.push(`/viagens/${viagemId}`);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScreenHeader
        title="Notificações"
        right={
          naoLidas > 0 ? (
            <Pressable
              onPress={() => marcarTodas.mutate()}
              hitSlop={8}
              className="px-2 py-2 active:opacity-70"
              accessibilityLabel="Marcar todas como lidas"
            >
              <Text className="text-sm font-semibold text-white/90">Marcar todas</Text>
            </Pressable>
          ) : undefined
        }
      />

      <FlatList<Notificacao>
        data={itens}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={q.isFetching && !q.isFetchingNextPage}
            onRefresh={() => void q.refetch()}
          />
        }
        onEndReached={() => {
          if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        }}
        onEndReachedThreshold={0.6}
        renderItem={({ item, index }) => (
          <Animated.View
            entering={FadeInDown.delay(Math.min(index, 8) * 25).duration(180)}
          >
            <NotificacaoCard n={item} onTap={() => handleTap(item)} />
          </Animated.View>
        )}
        ListEmptyComponent={
          q.isLoading ? (
            <View className="gap-3">
              <ViagemCardSkeleton />
              <ViagemCardSkeleton />
            </View>
          ) : (
            <EmptyState
              icon={Bell}
              title="Sem notificações"
              description="Quando o admin enviar algo, aparece aqui."
            />
          )
        }
        ListFooterComponent={
          q.isFetchingNextPage ? (
            <View className="items-center py-4">
              <ActivityIndicator />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function NotificacaoCard({
  n,
  onTap,
}: {
  n: Notificacao;
  onTap: () => void;
}) {
  const lida = n.lida;
  return (
    <Pressable
      onPress={onTap}
      className={`rounded-2xl border-2 p-4 active:opacity-75 ${
        lida ? "border-border bg-card" : "border-primary/40 bg-primary/5"
      }`}
    >
      <View className="flex-row items-start gap-3">
        {!lida && <View className="mt-2 h-2.5 w-2.5 rounded-full bg-primary" />}
        <View className="flex-1">
          <Text
            className={`text-base ${lida ? "font-semibold text-foreground" : "font-extrabold text-foreground"}`}
            numberOfLines={2}
          >
            {n.titulo}
          </Text>
          <Text className="mt-1 text-sm text-foreground/85" numberOfLines={4}>
            {n.corpo}
          </Text>
          <Text
            className="mt-2 text-xs font-medium text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {fmtRelativo(n.criadoEm)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function fmtRelativo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}
