import { router } from "expo-router";
import { Megaphone, MessageCircle, PenSquare, ShieldOff } from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ConversaResumo } from "@ronan/shared-types";
import { EmptyState } from "@/components/empty-state";
import { fmtDataHoraCurta } from "@/lib/datetime";
import { useConversas } from "@/lib/chat";

/**
 * Lista de conversas — a "tela inicial" do chat. O canal de Avisos fica
 * sempre no topo; o resto ordena pela mensagem mais recente.
 */
export default function ConversasScreen() {
  const q = useConversas();
  const conversas = q.data?.conversas ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-row items-center gap-3 bg-brand px-4 pb-4 pt-4">
        <Text className="flex-1 text-2xl font-bold text-white">Conversas</Text>
        <Pressable
          onPress={() => router.push("/chat/bloqueados")}
          hitSlop={8}
          accessibilityLabel="Motoristas bloqueados"
          className="h-11 w-11 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
        >
          <ShieldOff size={20} color="white" />
        </Pressable>
        <Pressable
          onPress={() => router.push("/chat/nova")}
          hitSlop={8}
          accessibilityLabel="Nova conversa"
          className="h-11 w-11 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
        >
          <PenSquare size={20} color="white" />
        </Pressable>
      </View>

      {q.isLoading && conversas.length === 0 ? (
        <View className="py-12">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList<ConversaResumo>
          data={conversas}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={q.isFetching} onRefresh={() => void q.refetch()} />
          }
          ListEmptyComponent={
            <EmptyState
              icon={MessageCircle}
              title="Nenhuma conversa ainda"
              description="Toque no lápis pra falar com outro motorista."
            />
          }
          renderItem={({ item }) => <LinhaConversa c={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function LinhaConversa({ c }: { c: ConversaResumo }) {
  const avisos = c.tipo === "AVISOS";
  return (
    <Pressable
      onPress={() => router.push(`/chat/${c.id}`)}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-muted"
    >
      <View
        className={`h-14 w-14 items-center justify-center rounded-full ${
          avisos ? "bg-brand" : "bg-primary/15"
        }`}
      >
        {avisos ? (
          <Megaphone size={24} color="white" />
        ) : (
          <Text className="text-lg font-bold text-primary">{c.iniciais}</Text>
        )}
      </View>

      <View className="flex-1">
        <View className="flex-row items-baseline gap-2">
          <Text className="flex-1 text-base font-bold text-foreground" numberOfLines={1}>
            {c.titulo}
          </Text>
          {c.ultimaMensagemEm ? (
            <Text className="text-xs text-muted-foreground">
              {fmtDataHoraCurta(c.ultimaMensagemEm)}
            </Text>
          ) : null}
        </View>
        <View className="mt-0.5 flex-row items-center gap-2">
          <Text
            className={`flex-1 text-sm ${
              c.naoLidas > 0 ? "font-semibold text-foreground" : "text-muted-foreground"
            }`}
            numberOfLines={1}
          >
            {c.ultimaMensagemTexto ?? "Sem mensagens ainda"}
          </Text>
          {c.naoLidas > 0 ? (
            <View className="min-w-[24px] items-center justify-center rounded-full bg-primary px-2 py-0.5">
              <Text className="text-xs font-bold text-primary-foreground">
                {c.naoLidas > 99 ? "99+" : c.naoLidas}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
