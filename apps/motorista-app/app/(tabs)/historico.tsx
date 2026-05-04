import { useMemo, useState } from "react";
import { router } from "expo-router";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  WifiOff,
} from "lucide-react-native";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/empty-state";
import { ViagemCardSkeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  useResumoMes,
  useViagensFiltradas,
  type GrupoStatus,
  type Viagem,
} from "@/lib/queries";

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  ENVIADA: "warning",
  OK: "success",
  EM_CONFERENCIA: "warning",
  DIVERGENTE: "destructive",
  AJUSTADA: "secondary",
};

const statusLabel: Record<string, string> = {
  ENVIADA: "Enviada",
  OK: "Conferida",
  EM_CONFERENCIA: "Conferindo",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
};

const FILTROS: { key: "TODAS" | GrupoStatus; label: string }[] = [
  { key: "TODAS", label: "Todas" },
  { key: "AGUARDANDO", label: "Aguardando" },
  { key: "CONFERIDA", label: "Conferidas" },
  { key: "DIVERGENTE", label: "Divergentes" },
];

export default function HistoricoScreen() {
  const meses = useMemo(() => ultimosMeses(6), []);
  const [mesSelecionado, setMesSelecionado] = useState(meses[0].chave);
  const [filtroStatus, setFiltroStatus] = useState<"TODAS" | GrupoStatus>(
    "TODAS",
  );

  const resumo = useResumoMes(mesSelecionado);
  const lista = useViagensFiltradas({
    mes: mesSelecionado,
    status: filtroStatus === "TODAS" ? undefined : filtroStatus,
  });

  const itens = useMemo(
    () => lista.data?.pages.flatMap((p) => p.itens) ?? [],
    [lista.data],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      {/* Header brand */}
      <View className="bg-brand px-5 pb-4 pt-14">
        <Text className="text-xs font-semibold uppercase tracking-wider text-white/70">
          Histórico
        </Text>
        <Text className="mt-0.5 text-2xl font-bold text-white">
          Suas viagens por mês
        </Text>
      </View>

      <FlatList<Viagem>
        data={itens}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={lista.isFetching && !lista.isFetchingNextPage}
            onRefresh={() => {
              void lista.refetch();
              void resumo.refetch();
            }}
          />
        }
        onEndReached={() => {
          if (lista.hasNextPage && !lista.isFetchingNextPage) {
            void lista.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          <View className="mb-2 gap-3">
            {/* Chips de mes (horizontal) */}
            <View>
              <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Mês
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {meses.map((m) => {
                  const ativo = m.chave === mesSelecionado;
                  return (
                    <Pressable
                      key={m.chave}
                      onPress={() => setMesSelecionado(m.chave)}
                      className={`rounded-full border-2 px-4 py-2 ${
                        ativo
                          ? "border-primary bg-primary"
                          : "border-border bg-card"
                      }`}
                    >
                      <Text
                        className={`text-base font-bold ${
                          ativo ? "text-primary-foreground" : "text-foreground"
                        }`}
                      >
                        {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Card resumo do mes selecionado */}
            {resumo.data && (
              <View className="rounded-2xl border-2 border-border bg-card p-4">
                <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Resumo
                </Text>
                {resumo.data.totalViagens === 0 ? (
                  <Text className="mt-2 text-base text-muted-foreground">
                    Nenhuma viagem em {fmtMesLongo(resumo.data.mes)}.
                  </Text>
                ) : (
                  <>
                    <View className="mt-3 flex-row gap-6">
                      <ResumoStat
                        label="viagens"
                        value={String(resumo.data.totalViagens)}
                      />
                      <ResumoStat
                        label="t"
                        value={fmtNum(resumo.data.totalToneladas, 1)}
                      />
                      <ResumoStat
                        label="km"
                        value={fmtNum(resumo.data.totalKm, 0)}
                      />
                    </View>
                    {parseFloat(resumo.data.totalPedagio) > 0 && (
                      <View className="mt-3 border-t-2 border-border pt-3">
                        <ResumoStat
                          label="pedágio"
                          value={`R$ ${fmtNum(resumo.data.totalPedagio, 2)}`}
                        />
                      </View>
                    )}
                  </>
                )}
              </View>
            )}

            {/* Chips de status */}
            <View>
              <Text className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Filtrar
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {FILTROS.map((f) => {
                  const ativo = f.key === filtroStatus;
                  return (
                    <Pressable
                      key={f.key}
                      onPress={() => setFiltroStatus(f.key)}
                      className={`rounded-full border-2 px-4 py-2 ${
                        ativo
                          ? "border-foreground bg-foreground"
                          : "border-border bg-card"
                      }`}
                    >
                      <Text
                        className={`text-sm font-bold ${
                          ativo ? "text-background" : "text-foreground"
                        }`}
                      >
                        {f.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 20).duration(180)}>
            <ViagemCard v={item} />
          </Animated.View>
        )}
        ListEmptyComponent={
          lista.isLoading ? (
            <View className="gap-3">
              <ViagemCardSkeleton />
              <ViagemCardSkeleton />
              <ViagemCardSkeleton />
            </View>
          ) : lista.error ? (
            <EmptyState
              icon={WifiOff}
              title="Sem internet"
              description="Conecte pra ver o histórico."
              iconColor="#dc2626"
            />
          ) : (
            <EmptyState
              icon={Calendar}
              title="Nenhuma viagem"
              description="Tente outro mês ou troque o filtro."
            />
          )
        }
        ListFooterComponent={
          lista.isFetchingNextPage ? (
            <View className="items-center py-4">
              <ActivityIndicator />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function ViagemCard({ v }: { v: Viagem }) {
  const variant = statusVariant[v.status] ?? "outline";
  const label = statusLabel[v.status] ?? v.status;

  return (
    <Pressable
      onPress={() => router.push(`/viagens/${v.id}`)}
      className="rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground" numberOfLines={1}>
            {v.obra.nome}
          </Text>
          <Text
            className="mt-0.5 text-base font-medium text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {fmtData(v.data)} · {v.veiculo.placa}
          </Text>
        </View>
        <Badge variant={variant}>{label}</Badge>
      </View>

      <View className="mt-3 gap-1.5">
        <View className="flex-row items-center gap-2">
          <ArrowUp size={16} color="#16a34a" />
          <Text
            className="flex-1 text-base font-medium text-foreground"
            numberOfLines={1}
          >
            {v.localCarga.nome}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <ArrowDown size={16} color="#dc2626" />
          <Text
            className="flex-1 text-base font-medium text-foreground"
            numberOfLines={1}
          >
            {v.localDescarga.nome}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row gap-5 border-t-2 border-border pt-3">
        <Stat label="t" value={fmtNum(v.toneladas, 3)} />
        <Stat label="km" value={fmtNum(v.km, 2)} />
        <Stat label="ticket" value={v.ticket} />
      </View>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Text
        className="text-lg font-bold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}

function ResumoStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Text
        className="text-2xl font-extrabold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}

const MESES_CURTO = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const MESES_LONGO = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function ultimosMeses(n: number): { chave: string; label: string }[] {
  const out: { chave: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
    const ano = d.getFullYear();
    const m = d.getMonth();
    const chave = `${ano}-${String(m + 1).padStart(2, "0")}`;
    const label = `${MESES_CURTO[m]}/${String(ano).slice(2)}`;
    out.push({ chave, label });
  }
  return out;
}

function fmtMesLongo(mes: string): string {
  const [ano, m] = mes.split("-");
  const idx = Number(m) - 1;
  if (idx < 0 || idx > 11) return mes;
  return `${MESES_LONGO[idx]}/${ano.slice(2)}`;
}

function fmtData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

function fmtNum(v: string, casas: number): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
