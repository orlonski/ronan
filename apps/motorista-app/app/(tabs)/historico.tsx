import { useMemo, useState } from "react";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Fuel,
  Receipt,
  Trash2,
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
import { Swipeable } from "react-native-gesture-handler";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "@/components/empty-state";
import { ViagemCardSkeleton } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showAlert, showConfirm } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import {
  useAbastecimentos,
  useExcluirAbastecimento,
  useResumoMes,
  useViagensFiltradas,
  type Abastecimento,
  type GrupoStatus,
  type Viagem,
} from "@/lib/queries";

type Aba = "viagens" | "pedagios" | "abastecimentos";

const TIPO_LABEL: Record<string, string> = {
  DIESEL_S10: "Diesel S10",
  DIESEL_S500: "Diesel S500",
  ARLA_32: "ARLA 32",
  GASOLINA: "Gasolina",
  ETANOL: "Etanol",
};

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline" | "destructive" | "success" | "warning"
> = {
  ENVIADA: "warning",
  OK: "success",
  EM_CONFERENCIA: "warning",
  DIVERGENTE: "destructive",
  AJUSTADA: "secondary",
  AGUARDANDO_PESO: "warning",
};

const statusLabel: Record<string, string> = {
  ENVIADA: "Enviada",
  OK: "Conferida",
  EM_CONFERENCIA: "Conferindo",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
  AGUARDANDO_PESO: "Aguardando peso",
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
  const [aba, setAba] = useState<Aba>("viagens");
  const [filtroStatus, setFiltroStatus] = useState<"TODAS" | GrupoStatus>(
    "TODAS",
  );

  const resumo = useResumoMes(mesSelecionado);
  const viagens = useViagensFiltradas({
    mes: mesSelecionado,
    status: filtroStatus === "TODAS" ? undefined : filtroStatus,
  });
  // Aba "Pedágios" lista as viagens que tiveram pedágio (Viagem.valorPedagioTotal),
  // não o lançamento avulso da model Pedagio — essa feature nunca foi liberada.
  const pedagios = useViagensFiltradas({
    mes: mesSelecionado,
    comPedagio: true,
  });
  const abastecimentos = useAbastecimentos(mesSelecionado);
  const excluirAbastecimento = useExcluirAbastecimento();

  const itensAbastecimentos = abastecimentos.data ?? [];
  const totalAbastMes = itensAbastecimentos.length;

  const itensViagens = useMemo(
    () => viagens.data?.pages.flatMap((p) => p.itens) ?? [],
    [viagens.data],
  );
  const itensPedagios = useMemo(
    () => pedagios.data?.pages.flatMap((p) => p.itens) ?? [],
    [pedagios.data],
  );

  async function confirmarExcluirAbastecimento(a: Abastecimento) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const litros = parseFloat(a.litros);
    const valor = a.valorTotal != null ? parseFloat(a.valorTotal) : null;
    const valorStr = valor != null ? `(R$ ${valor.toFixed(2)})` : "(em comboio)";
    const ok = await showConfirm({
      title: "Excluir este abastecimento?",
      message: `Apagar abastecimento de ${litros.toFixed(2)} L ${valorStr}${a.postoNome ? ` em ${a.postoNome}` : ""}?`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await excluirAbastecimento.mutateAsync(a.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void showAlert({
        title: "Não foi possível excluir",
        message: humanizeApiError(err),
        variant: "destructive",
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  const totalViagensMes = resumo.data?.totalViagens ?? 0;
  const pedagiosResumo = resumo.data?.viagensComPedagio;
  const totalPedagiosMes = pedagiosResumo?.count ?? 0;

  const headerComponent = (
    <View className="mb-2 gap-3">
      {/* Toggle Viagens/Pedagios/Abastecimentos */}
      <View className="flex-row gap-2">
        <AbaButton
          ativo={aba === "viagens"}
          onPress={() => setAba("viagens")}
          label="Viagens"
          count={totalViagensMes}
        />
        <AbaButton
          ativo={aba === "pedagios"}
          onPress={() => setAba("pedagios")}
          label="Pedágios"
          count={totalPedagiosMes}
        />
        <AbaButton
          ativo={aba === "abastecimentos"}
          onPress={() => setAba("abastecimentos")}
          label="Abast."
          count={totalAbastMes}
        />
      </View>

      {/* Chips de mes */}
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

      {/* Card resumo */}
      {resumo.data && (
        <View className="rounded-2xl border-2 border-border bg-card p-4">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Resumo de {fmtMesLongo(resumo.data.mes)}
          </Text>
          {resumo.data.totalViagens === 0 && totalPedagiosMes === 0 ? (
            <Text className="mt-2 text-base text-muted-foreground">
              Nenhuma movimentação nesse mês.
            </Text>
          ) : (
            <>
              {resumo.data.totalViagens > 0 && (
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
              )}
              {pedagiosResumo && pedagiosResumo.count > 0 && (
                <View
                  className={`${resumo.data.totalViagens > 0 ? "mt-3 border-t-2 border-border pt-3" : "mt-3"} flex-row gap-6`}
                >
                  <ResumoStat
                    label="com pedágio"
                    value={String(pedagiosResumo.count)}
                  />
                  <ResumoStat
                    label="total"
                    value={`R$ ${fmtNum(pedagiosResumo.totalValor, 2)}`}
                  />
                </View>
              )}
            </>
          )}
        </View>
      )}

      {/* Chips de status (apenas viagens) */}
      {aba === "viagens" && (
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
      )}
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="bg-brand px-5 pb-4 pt-14">
        <Text className="text-xs font-semibold uppercase tracking-wider text-white/70">
          Histórico
        </Text>
        <Text className="mt-0.5 text-2xl font-bold text-white">
          {aba === "viagens"
            ? "Suas viagens por mês"
            : aba === "pedagios"
              ? "Seus pedágios por mês"
              : "Seus abastecimentos por mês"}
        </Text>
      </View>

      {aba === "viagens" && (
        <FlatList<Viagem>
          data={itensViagens}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={viagens.isFetching && !viagens.isFetchingNextPage}
              onRefresh={() => {
                void viagens.refetch();
                void resumo.refetch();
              }}
            />
          }
          onEndReached={() => {
            if (viagens.hasNextPage && !viagens.isFetchingNextPage) {
              void viagens.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.6}
          ListHeaderComponent={headerComponent}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(index * 20).duration(180)}
            >
              <ViagemCard v={item} />
            </Animated.View>
          )}
          ListEmptyComponent={
            viagens.isLoading ? (
              <View className="gap-3">
                <ViagemCardSkeleton />
                <ViagemCardSkeleton />
                <ViagemCardSkeleton />
              </View>
            ) : viagens.error ? (
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
            viagens.isFetchingNextPage ? (
              <View className="items-center py-4">
                <ActivityIndicator />
              </View>
            ) : null
          }
        />
      )}

      {aba === "pedagios" && (
        <FlatList<Viagem>
          data={itensPedagios}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={pedagios.isFetching && !pedagios.isFetchingNextPage}
              onRefresh={() => {
                void pedagios.refetch();
                void resumo.refetch();
              }}
            />
          }
          onEndReached={() => {
            if (pedagios.hasNextPage && !pedagios.isFetchingNextPage) {
              void pedagios.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.6}
          ListHeaderComponent={headerComponent}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(index * 20).duration(180)}
            >
              <ViagemPedagioCard v={item} />
            </Animated.View>
          )}
          ListEmptyComponent={
            pedagios.isLoading ? (
              <View className="gap-3">
                <ViagemCardSkeleton />
                <ViagemCardSkeleton />
              </View>
            ) : pedagios.error ? (
              <EmptyState
                icon={WifiOff}
                title="Sem internet"
                description="Conecte pra ver os pedágios."
                iconColor="#dc2626"
              />
            ) : (
              <EmptyState
                icon={Receipt}
                title="Nenhuma viagem com pedágio"
                description="O valor do pedágio é informado na hora de lançar a viagem."
              />
            )
          }
          ListFooterComponent={
            pedagios.isFetchingNextPage ? (
              <View className="items-center py-4">
                <ActivityIndicator />
              </View>
            ) : null
          }
        />
      )}

      {aba === "abastecimentos" && (
        <FlatList<Abastecimento>
          data={itensAbastecimentos}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={abastecimentos.isFetching}
              onRefresh={() => {
                void abastecimentos.refetch();
              }}
            />
          }
          ListHeaderComponent={headerComponent}
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(index * 20).duration(180)}
            >
              <AbastecimentoCard
                a={item}
                onExcluir={() => confirmarExcluirAbastecimento(item)}
              />
            </Animated.View>
          )}
          ListEmptyComponent={
            abastecimentos.isLoading ? (
              <View className="gap-3">
                <ViagemCardSkeleton />
                <ViagemCardSkeleton />
              </View>
            ) : abastecimentos.error ? (
              <EmptyState
                icon={WifiOff}
                title="Sem internet"
                description="Conecte pra ver os abastecimentos."
                iconColor="#dc2626"
              />
            ) : (
              <EmptyState
                icon={Fuel}
                title="Nenhum abastecimento"
                description='Cadastre tocando em "Abastecimento" na tela inicial.'
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

function AbaButton({
  ativo,
  onPress,
  label,
  count,
}: {
  ativo: boolean;
  onPress: () => void;
  label: string;
  count: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center rounded-2xl border-2 py-3 ${
        ativo ? "border-primary bg-primary" : "border-border bg-card"
      }`}
    >
      <Text
        className={`text-base font-bold ${
          ativo ? "text-primary-foreground" : "text-foreground"
        }`}
      >
        {label} {count > 0 ? `(${count})` : ""}
      </Text>
    </Pressable>
  );
}

function ViagemCard({ v }: { v: Viagem }) {
  const variant = statusVariant[v.status] ?? "outline";
  const label = statusLabel[v.status] ?? v.status;
  const aguardandoPeso = v.status === "AGUARDANDO_PESO";

  return (
    <Pressable
      onPress={() => router.push(`/viagens/${v.id}`)}
      className="rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground" numberOfLines={1}>
            {v.cliente.nome}
          </Text>
          <Text
            className="mt-0.5 text-base font-medium text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {fmtData(v.data)} · {v.veiculo.placa}
          </Text>
          <Text
            className="mt-0.5 text-xs text-muted-foreground/80"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            Cadastrada {fmtDataHoraCurta(v.sincronizadoEm)}
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
        <Stat
          label="t"
          value={aguardandoPeso ? "—" : fmtNum(v.toneladasEfetiva, 3)}
          subValue={
            aguardandoPeso
              ? "aguardando"
              : v.toneladasAjustada
                ? `(${fmtNum(v.toneladasInformada, 3)})`
                : undefined
          }
        />
        <Stat
          label="km"
          value={fmtNum(v.kmEfetivo, 2)}
          subValue={v.kmAjustada ? `(${fmtNum(v.kmInformado, 2)})` : undefined}
        />
        <Stat label="ticket" value={aguardandoPeso ? "—" : v.ticket} />
      </View>
    </Pressable>
  );
}

/**
 * Card da aba "Pedágios": mostra o pedágio pago, mas o item é uma VIAGEM —
 * tocar abre o detalhe dela. Sem swipe de excluir de propósito: apagar a
 * viagem inteira a partir daqui seria destrutivo demais.
 */
function ViagemPedagioCard({ v }: { v: Viagem }) {
  return (
    <Pressable
      onPress={() => router.push(`/viagens/${v.id}`)}
      className="rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="flex-row items-start justify-between gap-3">
        <Text
          className="flex-1 text-sm font-medium text-muted-foreground"
          style={{ fontVariant: ["tabular-nums"] }}
          numberOfLines={1}
        >
          {fmtData(v.data)} · {v.veiculo.placa}
        </Text>
        {!!v.ticket && <Badge variant="outline">Ticket {v.ticket}</Badge>}
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

      <View className="mt-3 border-t-2 border-border pt-3">
        <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          pedágio pago
        </Text>
        <Text
          className="text-2xl font-extrabold text-foreground"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          R$ {fmtNum(v.valorPedagioTotal ?? "0", 2)}
        </Text>
      </View>
    </Pressable>
  );
}

function AbastecimentoCard({
  a,
  onExcluir,
}: {
  a: Abastecimento;
  onExcluir: () => void;
}) {
  const litros = parseFloat(a.litros);
  const valor = a.valorTotal != null ? parseFloat(a.valorTotal) : null;
  const preco = a.precoLitro ? parseFloat(a.precoLitro) : null;

  const card = (
    <View className="rounded-2xl border-2 border-border bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text
            className="text-sm font-medium text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {fmtDataHoraCurta(a.data)} · {a.veiculo.placa}
          </Text>
          {a.postoNome && (
            <Text
              className="mt-0.5 text-base font-bold text-foreground"
              numberOfLines={2}
            >
              {a.postoNome}
            </Text>
          )}
          {a.empresa && (
            <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
              {a.empresa.nome}
            </Text>
          )}
        </View>
        <Badge variant="outline">{TIPO_LABEL[a.tipo] ?? a.tipo}</Badge>
      </View>

      <View className="mt-3 flex-row gap-5 border-t-2 border-border pt-3">
        <Stat
          label="L"
          value={litros.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        />
        <Stat
          label="R$"
          value={
            valor != null
              ? valor.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "comboio"
          }
        />
        {preco !== null && (
          <Stat
            label="R$/L"
            value={preco.toLocaleString("pt-BR", {
              minimumFractionDigits: 3,
              maximumFractionDigits: 3,
            })}
          />
        )}
        <Stat label="km" value={a.odometro.toLocaleString("pt-BR")} />
      </View>

      {a.fotos.length > 0 && (
        <Text className="mt-2 text-xs text-muted-foreground">
          📷 {a.fotos.length} {a.fotos.length === 1 ? "foto" : "fotos"}
        </Text>
      )}
    </View>
  );

  return (
    <Swipeable
      renderRightActions={() => (
        <View className="ml-2 flex-row items-stretch">
          <Button
            variant="destructive"
            className="h-full w-24 rounded-2xl"
            onPress={onExcluir}
          >
            <Trash2 size={22} color="white" />
          </Button>
        </View>
      )}
      overshootRight={false}
    >
      {card}
    </Swipeable>
  );
}

function Stat({
  label,
  value,
  subValue,
}: {
  label: string;
  value: string;
  subValue?: string;
}) {
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
      {subValue && (
        <Text className="text-[10px] text-muted-foreground">{subValue}</Text>
      )}
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
  // Parse manual pra evitar timezone shift.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

function fmtDataHoraCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes} ${hh}:${mm}`;
}

function fmtNum(v: string, casas: number): string {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
