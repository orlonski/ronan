import { useCallback, useMemo, useState } from "react";
import { router, Stack, useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Check, CircleAlert } from "lucide-react-native";
import type { ViagemPessoal } from "@ronan/shared-types";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { hojeISO } from "@/lib/datetime";

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Quem ainda me deve.
 *
 * A pergunta do dia 30 do autônomo, e a que o app não respondia: o resumo somava
 * tudo que ele lançou como "recebi", inclusive o frete de dois meses atrás que
 * ninguém pagou. Faturado não é recebido.
 *
 * A lista é de TODOS os meses. Dívida não tem mês — ela envelhece, que é
 * justamente o que a tela mostra em cima.
 */
export default function AReceberScreen() {
  const [fretes, setFretes] = useState<ViagemPessoal[] | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    let vivo = true;
    void api
      .fretesAReceber()
      .then((f) => vivo && setFretes(f))
      .catch(() => vivo && setFretes([]));
    return () => {
      vivo = false;
    };
  }, []);
  useFocusEffect(carregar);

  const total = useMemo(
    () => (fretes ?? []).reduce((s, f) => s + (f.valorRecebido ?? 0), 0),
    [fretes],
  );

  const porContratante = useMemo(() => {
    const mapa = new Map<string, ViagemPessoal[]>();
    for (const f of fretes ?? []) {
      const chave = f.contratante?.trim() || "Sem contratante anotado";
      mapa.set(chave, [...(mapa.get(chave) ?? []), f]);
    }
    return [...mapa.entries()]
      .map(([nome, itens]) => ({
        nome,
        itens,
        total: itens.reduce((s, f) => s + (f.valorRecebido ?? 0), 0),
      }))
      // Maior dívida primeiro: é por quem ele liga antes.
      .sort((a, b) => b.total - a.total);
  }, [fretes]);

  async function recebi(f: ViagemPessoal) {
    setMarcando(f.id);
    try {
      await api.marcarFreteRecebido(f.id, hojeISO());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFretes((atual) => (atual ?? []).filter((x) => x.id !== f.id));
    } finally {
      setMarcando(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Quem te deve" subtitle="Fretes feitos e ainda não pagos" />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}>
        {fretes === null && <ActivityIndicator />}

        {fretes?.length === 0 && (
          <View className="items-center gap-2 rounded-2xl border-2 border-border bg-card p-8">
            <Check size={32} color="#16a34a" />
            <Text className="text-lg font-bold text-foreground">Ninguém te deve</Text>
            <Text className="text-center text-base text-muted-foreground">
              Todo frete que você lançou com valor já está marcado como recebido.
            </Text>
          </View>
        )}

        {total > 0 && (
          <View className="rounded-2xl border-2 border-warning bg-warning/10 p-4">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Total em aberto
            </Text>
            <Text className="mt-1 text-4xl font-extrabold text-foreground">
              {dinheiro(total)}
            </Text>
          </View>
        )}

        {porContratante.map((grupo) => (
          <View key={grupo.nome} className="gap-2">
            <View className="flex-row items-end justify-between gap-3">
              <Text className="flex-1 text-lg font-extrabold text-foreground">
                {grupo.nome}
              </Text>
              <Text className="text-lg font-extrabold text-foreground">
                {dinheiro(grupo.total)}
              </Text>
            </View>

            {grupo.itens.map((f) => (
              <View key={f.id} className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
                <Pressable onPress={() => router.push(`/editar-frete?id=${f.id}`)}>
                  <Text className="text-base font-semibold text-foreground">
                    {f.origem} → {f.destino}
                  </Text>
                  <Text className="mt-0.5 text-sm text-muted-foreground">
                    {f.data.split("-").reverse().join("/")}
                    {f.km ? ` · ${f.km.toLocaleString("pt-BR")} km` : ""}
                    {f.carga ? ` · ${f.carga}` : ""}
                  </Text>
                  <Text className="mt-1 text-2xl font-extrabold text-foreground">
                    {dinheiro(f.valorRecebido ?? 0)}
                  </Text>
                </Pressable>

                <Envelhecimento data={f.data} />

                <Button
                  className="bg-success"
                  loading={marcando === f.id}
                  onPress={() => void recebi(f)}
                >
                  <Check size={20} color="white" />
                  <Text className="text-lg font-bold text-primary-foreground">Já caiu</Text>
                </Button>
              </View>
            ))}
          </View>
        ))}

        {(fretes?.length ?? 0) > 0 && (
          <Text className="text-sm text-muted-foreground">
            Some daqui quando você marcar “Já caiu”. Errou? Abra o frete e desmarque —
            o dinheiro volta pra esta lista.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Há quanto tempo o frete está em aberto.
 *
 * O número de dias é o argumento da ligação de cobrança. "Faz 62 dias" é uma
 * conversa diferente de "está pendente", e é a única coisa que a tela pode
 * dizer sem inventar prazo de contrato nenhum.
 */
function Envelhecimento({ data }: { data: string }) {
  const dias = Math.floor(
    (Date.now() - new Date(`${data}T12:00:00`).getTime()) / 86_400_000,
  );
  if (dias < 30) {
    return (
      <Text className="text-sm text-muted-foreground">
        {dias <= 0 ? "De hoje" : `Faz ${dias} ${dias === 1 ? "dia" : "dias"}`}
      </Text>
    );
  }
  return (
    <View className="flex-row items-center gap-2">
      <CircleAlert size={16} color={dias >= 60 ? "#dc2626" : "#b45309"} />
      <Text
        className={`text-sm font-semibold ${dias >= 60 ? "text-destructive" : "text-foreground"}`}
      >
        Faz {dias} dias
      </Text>
    </View>
  );
}
