import { useEffect } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LogOut, RefreshCw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/queries";
import { clearTokens } from "@/lib/auth";
import { setAuthState } from "@/lib/auth-state";
import { clearCadastroStatus, setCadastroStatus } from "@/lib/cadastro-status";

/**
 * Tela que cobre o app inteiro quando o cadastro do motorista ainda está
 * PENDENTE_APROVACAO. Ele já está logado, mas não consegue lançar nada até um
 * admin aprovar. Busca o /m/me (refetch ao focar) e, quando o status vira
 * APROVADO, atualiza o store — o AuthGate troca pro app normal sozinho.
 */
export function EmAnalise() {
  const me = useMe();

  useEffect(() => {
    if (me.data?.status) setCadastroStatus(me.data.status);
  }, [me.data?.status]);

  async function sair() {
    await clearTokens();
    await clearCadastroStatus();
    setAuthState(false);
    router.replace("/login");
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View className="bg-brand px-6 pb-10 pt-20">
          <Text className="text-5xl font-extrabold tracking-tight text-white">SCHABA</Text>
          <Text className="mt-2 text-base font-medium text-white/80">
            Aplicativo do motorista
          </Text>
        </View>

        <View className="flex-1 gap-6 px-6 py-10">
          <View className="gap-3">
            <Text className="text-2xl font-bold text-foreground">
              Cadastro em análise
            </Text>
            <Text className="text-base leading-6 text-muted-foreground">
              Recebemos seu cadastro! Estamos conferindo seus dados. Assim que for
              aprovado, o app libera pra você lançar viagens, pedágios e abastecimentos.
            </Text>
            <Text className="text-base leading-6 text-muted-foreground">
              Isso costuma ser rápido. Você pode tocar em “Já fui aprovado?” pra
              verificar de novo.
            </Text>
          </View>

          <View className="gap-3">
            <Button size="lg" loading={me.isFetching} onPress={() => me.refetch()}>
              <RefreshCw size={20} color="#fff" />
              <Text className="text-lg font-bold text-primary-foreground">
                {me.isFetching ? "Verificando..." : "Já fui aprovado?"}
              </Text>
            </Button>
            <Button size="lg" variant="outline" onPress={sair}>
              <LogOut size={20} color="#0f172a" />
              <Text className="text-lg font-semibold text-foreground">Sair</Text>
            </Button>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
