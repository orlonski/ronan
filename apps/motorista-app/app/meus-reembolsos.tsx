import { useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import { ReceiptText } from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { abrirGasto, LinhaGasto, SemGastoDeViagem } from "@/components/gastos";
import { Button } from "@/components/ui/button";
import {
  fmtReais,
  horaSP,
  resumirGastos,
  useDespesasAtualizadasEm,
  useGastos,
  useModuloDespesas,
  type GastoVisto,
} from "@/lib/gastos";

const MESES = [
  "JANEIRO",
  "FEVEREIRO",
  "MARÇO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];

/**
 * [E] MEUS REEMBOLSOS — quanto ele tem pra receber de volta e em que pé está
 * cada gasto. "Pra receber de volta", nunca "a empresa me deve": é o dinheiro
 * dele voltando, sem tom de dívida nem de cobrança.
 *
 * Offline: lista do cache + o que está no celular; nada some.
 */
export default function MeusReembolsos() {
  const modulo = useModuloDespesas();
  const { gastos, query } = useGastos({ enabled: modulo.acompanhar });
  const resumo = useMemo(() => resumirGastos(gastos), [gastos]);
  const atualizadoEm = useDespesasAtualizadasEm();
  const [aba, setAba] = useState<"receber" | "todos">("receber");
  // Spinner só no gesto (no iOS a recarga automática prende o spinner).
  const [puxando, setPuxando] = useState(false);

  const lista = useMemo(
    () => (aba === "receber" ? gastos.filter((g) => g.status.soma > 0) : gastos),
    [aba, gastos],
  );
  const grupos = useMemo(() => {
    const m = new Map<string, GastoVisto[]>();
    for (const g of lista) {
      const k = g.dia.slice(0, 7);
      const arr = m.get(k) ?? [];
      arr.push(g);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [lista]);

  if (!modulo.acompanhar) return <SemGastoDeViagem titulo="Meus reembolsos" />;

  const semCacheEErro = query.isError && !query.data && gastos.length === 0;
  const desatualizado =
    atualizadoEm != null && (query.isError || Date.now() - atualizadoEm > 5 * 60_000);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Meus reembolsos" />
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
        <View>
          <Text className="text-sm font-semibold text-muted-foreground">Pra receber de volta</Text>
          <Text className="text-[32px] font-bold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>
            {fmtReais(resumo.total)}
          </Text>
          {desatualizado ? (
            <Text className="text-xs text-muted-foreground">
              Atualizado às {horaSP(new Date(atualizadoEm!).toISOString())}
            </Text>
          ) : null}
          {resumo.aprovado > 0 ? (
            <View className="mt-2 flex-row items-start gap-2">
              <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-success" />
              <Text className="flex-1 text-[15px] text-foreground">
                {fmtReais(resumo.aprovado)} aprovado — entra no próximo acerto
              </Text>
            </View>
          ) : null}
          {resumo.comEscritorio > 0 ? (
            <View className="mt-1 flex-row items-start gap-2">
              <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-sky-400" />
              <Text className="flex-1 text-[15px] text-foreground">
                {fmtReais(resumo.comEscritorio)} com o escritório
              </Text>
            </View>
          ) : null}
        </View>

        {resumo.semViagem > 0 && modulo.lancar ? (
          <Pressable
            onPress={() => router.push("/gastos-sem-viagem")}
            className="flex-row items-center justify-between rounded-xl bg-sky-50 px-4 active:opacity-75"
            style={{ minHeight: 56 }}
            accessibilityRole="button"
          >
            <Text className="text-base text-foreground">
              {resumo.semViagem} {resumo.semViagem === 1 ? "gasto sem viagem" : "gastos sem viagem"}
            </Text>
            <Text className="text-base font-semibold text-brand">Ligar agora ›</Text>
          </Pressable>
        ) : null}

        {/* Duas abas de TEXTO (não botões grandes). Abre em "Pra receber". */}
        <View className="flex-row gap-6 border-b border-border">
          {(
            [
              ["receber", "Pra receber"],
              ["todos", "Todos"],
            ] as const
          ).map(([k, rotulo]) => (
            <Pressable
              key={k}
              onPress={() => setAba(k)}
              accessibilityRole="tab"
              accessibilityState={{ selected: aba === k }}
              className={`pb-2 ${aba === k ? "border-b-2 border-brand" : ""}`}
              style={{ minHeight: 44, justifyContent: "flex-end" }}
            >
              <Text
                className={`text-base ${aba === k ? "font-bold text-brand" : "font-medium text-muted-foreground"}`}
              >
                {rotulo}
              </Text>
            </Pressable>
          ))}
        </View>

        {semCacheEErro ? (
          <View className="gap-3 rounded-2xl border-2 border-border p-4">
            <Text className="text-base text-foreground">
              Não deu pra carregar agora. Seus gastos guardados no celular estão seguros.
            </Text>
            <Button variant="outline" onPress={() => void query.refetch()}>
              Tentar de novo
            </Button>
          </View>
        ) : lista.length === 0 && !query.isLoading ? (
          <View className="items-center gap-3 px-4 py-8">
            <View className="h-20 w-20 items-center justify-center rounded-full bg-muted">
              <ReceiptText size={40} color="#94a3b8" />
            </View>
            <Text className="text-center text-lg font-bold text-foreground">
              Nenhum gasto por aqui ainda.
            </Text>
            <Text className="text-center text-base text-muted-foreground">
              Pagou alguma coisa na estrada? Lance com a foto do papel e ele volta pra você no acerto.
            </Text>
            {modulo.lancar ? (
              <Button className="mt-2 self-stretch" onPress={() => router.push("/gasto-viagem")}>
                Lançar gasto de viagem
              </Button>
            ) : null}
          </View>
        ) : (
          grupos.map(([mes, itens]) => (
            <View key={mes} className="gap-2">
              <Text className="text-xs font-bold tracking-wider text-muted-foreground">
                {MESES[Number(mes.slice(5, 7)) - 1] ?? mes}
              </Text>
              <View className="overflow-hidden rounded-2xl border-2 border-border bg-card">
                {itens.map((g, i) => (
                  <View key={g.chave}>
                    {i > 0 ? <View className="h-px bg-border" /> : null}
                    <LinhaGasto g={g} onPress={() => abrirGasto(g)} />
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
