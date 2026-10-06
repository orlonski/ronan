import { useMemo, useState } from "react";
import { router } from "expo-router";
import { Link, Plus, ReceiptText, RefreshCw } from "lucide-react-native";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { abrirGasto, BotaoAcao, LinhaGasto, SemGastoDeViagem } from "@/components/gastos";
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
 * [E] MEUS GASTOS — quanto ele tem pra receber de volta e em que pé está
 * cada gasto. "Pra receber de volta", nunca "a empresa me deve": é o dinheiro
 * dele voltando, sem tom de dívida nem de cobrança.
 *
 * Mora em dois lugares com o MESMO código:
 * - a aba "Gastos" (`naAba`): sem voltar, e com o botão de lançar no topo —
 *   a aba é o lugar de lançar E de acompanhar;
 * - a rota `/meus-reembolsos` (botão "Ver meus gastos" da home, Perfil...),
 *   empilhada, com voltar.
 *
 * Offline: lista do cache + o que está no celular; nada some.
 */
export function MeusGastos({ naAba = false }: { naAba?: boolean }) {
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

  const titulo = naAba ? "Gastos" : "Meus gastos";
  if (!modulo.acompanhar) return <SemGastoDeViagem titulo={titulo} />;

  const semCacheEErro = query.isError && !query.data && gastos.length === 0;
  const desatualizado =
    atualizadoEm != null && (query.isError || Date.now() - atualizadoEm > 5 * 60_000);

  return (
    // Na aba, o tab bar já cuida do rodapé.
    <SafeAreaView className="flex-1 bg-background" edges={naAba ? [] : ["bottom"]}>
      <ScreenHeader title={titulo} semVoltar={naAba} />
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
        {naAba && modulo.lancar ? (
          <BotaoAcao Icone={Plus} variant="default" className="h-16" onPress={() => router.push("/gasto-viagem")}>
            Lançar gasto de viagem
          </BotaoAcao>
        ) : null}

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
          <View className="gap-2 rounded-xl bg-sky-50 p-4">
            <Text className="text-base text-foreground">
              {resumo.semViagem} {resumo.semViagem === 1 ? "gasto sem viagem" : "gastos sem viagem"}
            </Text>
            <BotaoAcao Icone={Link} onPress={() => router.push("/gastos-sem-viagem")}>
              Ligar à viagem
            </BotaoAcao>
          </View>
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
            <BotaoAcao Icone={RefreshCw} onPress={() => void query.refetch()}>
              Tentar de novo
            </BotaoAcao>
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
            {/* Na aba o botão de lançar já está no topo — repetir aqui é
                dois botões iguais na mesma tela. */}
            {modulo.lancar && !naAba ? (
              <BotaoAcao
                Icone={Plus}
                variant="default"
                className="mt-2 self-stretch"
                onPress={() => router.push("/gasto-viagem")}
              >
                Lançar gasto de viagem
              </BotaoAcao>
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
