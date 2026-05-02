import { router } from "expo-router";
import { LogOut } from "lucide-react-native";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clearTokens } from "@/lib/auth";
import { useMe } from "@/lib/queries";

export default function Home() {
  const me = useMe();

  async function sair() {
    await clearTokens();
    router.replace("/login");
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <View className="flex-row items-start justify-between">
          <View>
            <Text className="text-2xl font-semibold text-foreground">Bem-vindo</Text>
            {me.isLoading && <ActivityIndicator className="mt-2" />}
            {me.data && (
              <>
                <Text className="mt-1 text-base text-foreground">{me.data.nome}</Text>
                {me.data.veiculoDefault && (
                  <Text className="text-sm text-muted-foreground">
                    Placa padrão: {me.data.veiculoDefault.placa}
                  </Text>
                )}
              </>
            )}
            {me.error && (
              <Text className="mt-1 text-sm text-destructive">
                Erro ao carregar perfil: {(me.error as Error).message}
              </Text>
            )}
          </View>
          <Button variant="ghost" size="icon" onPress={sair}>
            <LogOut size={20} color="#0f172a" />
          </Button>
        </View>

        <Card>
          <Text className="text-base font-medium text-foreground">
            Próximas etapas
          </Text>
          <Text className="mt-2 text-sm text-muted-foreground">
            Listagem de viagens, nova viagem e novo pedágio chegam nas próximas fases.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
