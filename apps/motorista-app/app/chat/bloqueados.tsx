import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShieldOff } from "lucide-react-native";
import { EmptyState } from "@/components/empty-state";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { showConfirm } from "@/lib/alert";
import { useBloqueios, useDesbloquear } from "@/lib/chat";

/** Quem o motorista bloqueou — e o caminho de voltar atrás. */
export default function BloqueadosScreen() {
  const q = useBloqueios();
  const desbloquear = useDesbloquear();
  const lista = q.data ?? [];

  async function tirar(motoristaId: string, nome: string) {
    const ok = await showConfirm({
      title: `Desbloquear ${nome}?`,
      message: "Vocês voltam a poder trocar mensagem.",
      confirmLabel: "Desbloquear",
    });
    if (ok) desbloquear.mutate(motoristaId);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScreenHeader title="Bloqueados" />
      {q.isLoading ? (
        <View className="py-12">
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(b) => b.motoristaId}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          ListEmptyComponent={
            <EmptyState
              icon={ShieldOff}
              title="Ninguém bloqueado"
              description="Se alguém incomodar, dá pra bloquear direto na conversa."
            />
          }
          renderItem={({ item }) => (
            <View className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
              <Text className="flex-1 text-base font-semibold text-foreground">
                {item.nome}
              </Text>
              <Button
                variant="outline"
                size="sm"
                onPress={() => void tirar(item.motoristaId, item.nome)}
                loading={desbloquear.isPending}
              >
                Desbloquear
              </Button>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
