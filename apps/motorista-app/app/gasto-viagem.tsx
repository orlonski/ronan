import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { SemGastoDeViagem } from "@/components/gastos";
import { ListaTiposGasto } from "@/components/lista-tipos-gasto";
import { useModuloDespesas } from "@/lib/gastos";

/**
 * [A] "O que você pagou?" como TELA — hoje só pros caminhos de dentro da
 * viagem ("Adicionar gasto" em "Gastos desta viagem" e o "Lançar outro" da
 * faixa ali dentro). Fora da viagem, a lista mora direto na aba Gastos
 * (decisão do dono, 06/10/2026). Sem "Ver meus gastos" aqui: quem chega
 * por esta tela está dentro da viagem, e a lista dele mora na aba.
 */
export default function GastoViagem() {
  const params = useLocalSearchParams<{
    viagemClientId?: string;
    viagemRotulo?: string;
    veiculoId?: string;
  }>();
  const daViagem = !!params.viagemClientId;
  const modulo = useModuloDespesas();

  const titulo = daViagem ? "Gasto desta viagem" : "Gastos";
  if (!modulo.lancar) return <SemGastoDeViagem titulo={titulo} />;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={titulo} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
        <View className="gap-1">
          <Text className="text-2xl font-bold text-foreground">O que você pagou?</Text>
          {/* Sem prometer devolução: a lista tem "Por sua conta" e diesel que
              pode ter sido da empresa (12-qa-portas, achado 4). */}
          <Text className="text-sm text-muted-foreground">
            Pagou do seu bolso? Lance aqui com a foto.
          </Text>
        </View>

        {/* Esta tela fica no meio: o formulário fecha ele e ela (`voltar: "2"`). */}
        <ListaTiposGasto
          voltar="2"
          contexto={{
            viagemClientId: params.viagemClientId,
            viagemRotulo: params.viagemRotulo,
            veiculoId: params.veiculoId,
          }}
        />

        {daViagem ? (
          <Text className="text-sm text-muted-foreground">
            Pedágio desta viagem: use o campo Pedágio da tela anterior.
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
