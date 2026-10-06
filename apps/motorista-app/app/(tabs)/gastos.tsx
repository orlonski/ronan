import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { FaixaGastoSalvo, ResumoPraReceber, SemGastoDeViagem } from "@/components/gastos";
import { ListaTiposGasto } from "@/components/lista-tipos-gasto";
import { useGastos, useModuloDespesas } from "@/lib/gastos";

/**
 * ABA GASTOS — a ÚNICA casa do gasto (decisão do dono, 06/10/2026; ver
 * docs/despesas-viagem/11 e 12). Só em empresa com o módulo "Gasto de
 * viagem", no lugar da aba Caderno (`useAbaGastos`, `(tabs)/_layout.tsx`).
 *
 * De cima pra baixo:
 * 1. "Pra receber de volta" compacto, com "Ver meus gastos" (sempre) e
 *    "Ligar à viagem (N)" (quando há) — o valor nunca cai abaixo da dobra;
 * 2. "O que você pagou?" — a lista de tipos, um toque e cai no formulário.
 *
 * Depois de salvar, a faixa verde (só a frase) aparece fixa sob o título.
 *
 * Quem só acompanha (empresa cancelou o módulo, mas ele tem histórico) vê
 * só o resumo, sem a lista de lançar.
 */
export default function GastosScreen() {
  const modulo = useModuloDespesas();
  const { query } = useGastos({ enabled: modulo.acompanhar });
  // Spinner só no gesto (no iOS a recarga automática prende o spinner).
  const [puxando, setPuxando] = useState(false);

  if (!modulo.acompanhar) return <SemGastoDeViagem titulo="Gastos" />;

  return (
    // Na aba, o tab bar já cuida do rodapé.
    <SafeAreaView className="flex-1 bg-background" edges={[]}>
      <ScreenHeader title="Gastos" semVoltar />
      {/* Fora da rolagem, logo abaixo do título: voltando do formulário pra
          uma aba já rolada, a faixa dentro do ScrollView nascia fora da vista. */}
      <FaixaGastoSalvo semBotoes />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={puxando}
            onRefresh={() => {
              setPuxando(true);
              void query.refetch().finally(() => setPuxando(false));
            }}
          />
        }
      >
        <ResumoPraReceber podeLigar={modulo.lancar} />

        {modulo.lancar ? (
          <View className="gap-3">
            <View className="gap-1">
              <Text className="text-2xl font-bold text-foreground">O que você pagou?</Text>
              <Text className="text-sm text-muted-foreground">
                Pagou do seu bolso? Lance aqui com a foto.
              </Text>
            </View>
            {/* Aberto da aba, o formulário fecha só ele (`voltar: "1"`). */}
            <ListaTiposGasto voltar="1" />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
