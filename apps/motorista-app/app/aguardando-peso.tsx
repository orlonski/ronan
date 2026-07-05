import { router, Stack } from "expo-router";
import { ChevronRight, Scale } from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { EmptyState } from "@/components/empty-state";
import { ViagemAguardandoInfo } from "@/components/viagem-aguardando-info";
import { useViagensAguardandoPeso } from "@/lib/queries";

/**
 * Lista as viagens lançadas sem peso (AGUARDANDO_PESO). O motorista toca numa
 * pra completar o peso + romaneio quando ele sair no fim do dia.
 */
export default function AguardandoPeso() {
  const aguardando = useViagensAguardandoPeso();
  const viagens = aguardando.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Aguardando peso" />
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 gap-3"
        refreshControl={
          <RefreshControl
            refreshing={aguardando.isRefetching}
            onRefresh={() => aguardando.refetch()}
          />
        }
      >
        {aguardando.isLoading && viagens.length === 0 ? (
          <View className="items-center py-16">
            <ActivityIndicator />
          </View>
        ) : viagens.length === 0 ? (
          <EmptyState
            icon={Scale}
            title="Nada aguardando peso"
            description="Quando você lançar uma viagem sem o peso, ela aparece aqui pra completar depois."
          />
        ) : (
          <>
            <Text className="px-1 text-sm text-muted-foreground">
              Toque numa viagem pra informar o peso e o romaneio (ticket).
            </Text>
            {viagens.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => router.push(`/completar-peso?viagemId=${v.id}`)}
                className="flex-row items-start gap-3 rounded-2xl border-2 border-amber-500/30 bg-card p-4 active:opacity-75"
              >
                <View className="h-10 w-10 items-center justify-center rounded-full bg-amber-500/15">
                  <Scale size={20} color="#d97706" />
                </View>
                <ViagemAguardandoInfo viagem={v} />
                <ChevronRight size={22} color="#94a3b8" style={{ marginTop: 4 }} />
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
