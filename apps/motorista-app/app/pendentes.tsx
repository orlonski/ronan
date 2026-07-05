import { useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { CloudOff, Pencil, RefreshCw, Scale, Trash2 } from "lucide-react-native";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Swipeable, GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { showConfirm } from "@/lib/alert";
import {
  type PendingViagem,
  type PendingPedagio,
  type PendingAbastecimento,
  type PendingCompletarPeso,
  type ZodIssueSaved,
} from "@/db/database";
import { usePendingViagens } from "@/hooks/use-pending-viagens";
import { usePendingPedagios } from "@/hooks/use-pending-pedagios";
import { usePendingAbastecimentos } from "@/hooks/use-pending-abastecimentos";
import { usePendingLifecycle, type LifecycleTrip } from "@/hooks/use-pending-lifecycle";
import { usePendingCompletarPeso } from "@/hooks/use-pending-completar-peso";
import {
  descartarViagemPendente,
  descartarPedagioPendente,
  descartarAbastecimentoPendente,
  descartarCompletarPesoPendente,
  drain,
  tentarNovamenteViagemPendente,
  tentarNovamentePedagioPendente,
  tentarNovamenteAbastecimentoPendente,
  tentarNovamenteCompletarPeso,
  tentarNovamenteTripLifecycle,
} from "@/lib/sync";
import { descartarViagemGuiada } from "@/lib/lifecycle";
import { useCatalogos } from "@/lib/queries";
import { frasePorCodigo, labelDoCampo } from "@/lib/validation";

/** Item do outbox de qualquer tipo, pra listar tudo junto. */
type PendingRow =
  | { kind: "viagem"; item: PendingViagem }
  | { kind: "pedagio"; item: PendingPedagio }
  | { kind: "abastecimento"; item: PendingAbastecimento };

const TIPO_COMBUSTIVEL_LABEL: Record<string, string> = {
  DIESEL_S10: "Diesel S10",
  DIESEL_S500: "Diesel S500",
  ARLA_32: "ARLA 32",
  GASOLINA: "Gasolina",
  ETANOL: "Etanol",
};

export default function Pendentes() {
  const viagens = usePendingViagens();
  const pedagios = usePendingPedagios();
  const abastecimentos = usePendingAbastecimentos();
  const lifecycleTrips = usePendingLifecycle();
  const completarPeso = usePendingCompletarPeso();
  const cat = useCatalogos();

  async function descartarCompletar(item: PendingCompletarPeso) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await showConfirm({
      title: "Descartar este envio?",
      message:
        "O peso digitado não vai ser enviado. A viagem continua esperando o peso — você pode informar de novo depois.",
      confirmLabel: "Descartar",
      destructive: true,
    });
    if (!ok) return;
    await descartarCompletarPesoPendente(item.viagemId);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
  const [detalheItem, setDetalheItem] = useState<PendingComum | null>(null);

  async function descartarTrip(trip: LifecycleTrip) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await showConfirm({
      title: "Descartar esta viagem?",
      message:
        "A viagem em andamento vai ser cancelada (aqui e no escritório). Isso não pode ser desfeito.",
      confirmLabel: "Descartar",
      destructive: true,
    });
    if (!ok) return;
    await descartarViagemGuiada(trip.clientId);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  // Junta tudo numa lista só, mais antigos primeiro (ordem de criação).
  const rows = useMemo<PendingRow[]>(() => {
    const all: PendingRow[] = [
      ...viagens.map((item) => ({ kind: "viagem" as const, item })),
      ...pedagios.map((item) => ({ kind: "pedagio" as const, item })),
      ...abastecimentos.map((item) => ({ kind: "abastecimento" as const, item })),
    ];
    return all.sort((a, b) => a.item.createdAt - b.item.createdAt);
  }, [viagens, pedagios, abastecimentos]);

  // Helpers de lookup por id no catalogo
  const lookups = useMemo(() => {
    if (!cat.data) return null;
    const v = new Map(cat.data.veiculos.map((x) => [x.id, x]));
    const o = new Map(cat.data.clientes.map((x) => [x.id, x]));
    const m = new Map(cat.data.materiais.map((x) => [x.id, x]));
    const l = new Map(cat.data.locais.map((x) => [x.id, x]));
    const e = new Map((cat.data.empresas ?? []).map((x) => [x.id, x]));
    return { v, o, m, l, e };
  }, [cat.data]);

  async function confirmarExcluir(row: PendingRow) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const nome =
      row.kind === "viagem"
        ? "esta viagem"
        : row.kind === "pedagio"
          ? "este pedágio"
          : "este abastecimento";
    const ok = await showConfirm({
      title: `Excluir ${nome}?`,
      message: "Ainda não foi enviado. Apagar agora não pode ser desfeito.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    if (row.kind === "viagem") await descartarViagemPendente(row.item.clientId);
    else if (row.kind === "pedagio") await descartarPedagioPendente(row.item.clientId);
    else await descartarAbastecimentoPendente(row.item.clientId);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function onTentarNovamente(row: PendingRow) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (row.kind === "viagem") await tentarNovamenteViagemPendente(row.item.clientId);
    else if (row.kind === "pedagio") await tentarNovamentePedagioPendente(row.item.clientId);
    else await tentarNovamenteAbastecimentoPendente(row.item.clientId);
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Aguardando internet" />

        <FlatList<PendingRow>
          data={rows}
          keyExtractor={(r) => `${r.kind}-${r.item.clientId}`}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          ListHeaderComponent={
            rows.length > 0 || lifecycleTrips.length > 0 || completarPeso.length > 0 ? (
              <View className="mb-2 gap-3">
                <Text className="text-sm text-muted-foreground">
                  Lançamentos aguardando envio. Toque em &quot;Sincronizar&quot; pra tentar
                  enviar agora.
                </Text>
                <Button onPress={() => void drain()}>Sincronizar agora</Button>
                {lifecycleTrips.map((trip) => (
                  <LifecycleTripCard
                    key={`lc-${trip.clientId}`}
                    trip={trip}
                    onDescartar={() => descartarTrip(trip)}
                    onTentarNovamente={() => tentarNovamenteTripLifecycle(trip.clientId)}
                  />
                ))}
                {completarPeso.map((item) => (
                  <CompletarPesoCard
                    key={`cp-${item.viagemId}`}
                    item={item}
                    onDescartar={() => descartarCompletar(item)}
                    onEditar={() =>
                      router.push(`/completar-peso?viagemId=${item.viagemId}`)
                    }
                    onTentarNovamente={() => tentarNovamenteCompletarPeso(item.viagemId)}
                  />
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            lifecycleTrips.length === 0 && completarPeso.length === 0 ? (
              <EmptyState
                icon={CloudOff}
                title="Tudo sincronizado"
                description="Nenhum lançamento aguardando internet."
              />
            ) : null
          }
          renderItem={({ item: row }) => (
            <PendingCard
              row={row}
              lookups={lookups}
              onExcluir={() => confirmarExcluir(row)}
              onTentarNovamente={() => onTentarNovamente(row)}
              onVerDetalhes={() => setDetalheItem(row.item)}
            />
          )}
        />

        <DetalheModal item={detalheItem} onClose={() => setDetalheItem(null)} />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

type Lookups = {
  v: Map<string, { id: string; placa: string; modelo: string | null }>;
  o: Map<string, { id: string; nome: string }>;
  m: Map<string, { id: string; nome: string }>;
  l: Map<string, { id: string; nome: string; cidade: string; uf: string }>;
  e: Map<string, { id: string; nome: string }>;
} | null;

const ESTAGIO_LABEL: Record<LifecycleTrip["estagio"], string> = {
  abrindo: "Abrindo a viagem",
  registrando: "Registrando eventos",
  fechando: "Fechando a viagem",
};

function LifecycleTripCard({
  trip,
  onDescartar,
  onTentarNovamente,
}: {
  trip: LifecycleTrip;
  onDescartar: () => void;
  onTentarNovamente: () => void;
}) {
  const temErro = trip.status === "error";
  return (
    <View className="rounded-2xl border-2 border-border bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Badge variant="outline">Viagem guiada</Badge>
          <Text className="mt-1.5 text-lg font-bold text-foreground">
            Viagem em andamento
          </Text>
          <Text className="mt-0.5 text-base font-medium text-muted-foreground">
            {ESTAGIO_LABEL[trip.estagio]}
          </Text>
        </View>
        <Badge variant={temErro ? "destructive" : "warning"}>
          {temErro
            ? trip.errorStatus
              ? `Erro ${trip.errorStatus}`
              : `Falhou (${trip.attempts})`
            : "Enviando"}
        </Badge>
      </View>

      {temErro && (
        <View className="mt-3 gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <Text className="text-xs font-semibold text-destructive">Último erro:</Text>
          <Text className="text-xs text-destructive" numberOfLines={3}>
            {trip.errorStatus === 409
              ? "Você tem uma viagem começada que não foi finalizada. Descarte esta pra poder começar outra."
              : (trip.errorMsg ?? "Erro desconhecido.")}
          </Text>
        </View>
      )}

      <View className="mt-3 flex-row gap-2">
        <Button variant="outline" size="sm" className="flex-1" onPress={onDescartar}>
          <Trash2 size={16} color="#dc2626" />
          <Text className="ml-1 font-semibold text-destructive">Descartar</Text>
        </Button>
        {temErro && (
          <Button size="sm" className="flex-1" onPress={onTentarNovamente}>
            <RefreshCw size={16} color="white" />
            <Text className="ml-1 font-semibold text-primary-foreground">Tentar de novo</Text>
          </Button>
        )}
      </View>
    </View>
  );
}

function CompletarPesoCard({
  item,
  onDescartar,
  onEditar,
  onTentarNovamente,
}: {
  item: PendingCompletarPeso;
  onDescartar: () => void;
  onEditar: () => void;
  onTentarNovamente: () => void;
}) {
  const temErro = item.status === "error";
  return (
    <View className="rounded-2xl border-2 border-amber-500/40 bg-card p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 flex-row items-start gap-2">
          <Scale size={20} color="#d97706" />
          <View className="flex-1">
            <Badge variant="outline">Peso da viagem</Badge>
            <Text className="mt-1.5 text-lg font-bold text-foreground">
              Completar peso
            </Text>
            <Text className="mt-0.5 text-base font-medium text-muted-foreground">
              {item.payload.toneladas} t
              {item.payload.ticket ? ` · ticket ${item.payload.ticket}` : ""}
            </Text>
          </View>
        </View>
        <Badge variant={temErro ? "destructive" : "warning"}>
          {temErro
            ? item.errorStatus
              ? `Erro ${item.errorStatus}`
              : `Falhou (${item.attempts})`
            : "Enviando"}
        </Badge>
      </View>

      {temErro && (
        <View className="mt-3 gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <Text className="text-xs font-semibold text-destructive">Último erro:</Text>
          <Text className="text-xs text-destructive" numberOfLines={3}>
            {item.errorStatus === 409
              ? "Esse ticket já foi lançado pra essa empresa. Toque em Editar pra corrigir o número."
              : (item.errorMsg ?? "Erro desconhecido.")}
          </Text>
        </View>
      )}

      <View className="mt-3 flex-row gap-2">
        <Button variant="outline" size="sm" className="flex-1" onPress={onDescartar}>
          <Trash2 size={16} color="#dc2626" />
          <Text className="ml-1 font-semibold text-destructive">Descartar</Text>
        </Button>
        {temErro && (
          <>
            <Button variant="outline" size="sm" className="flex-1" onPress={onEditar}>
              <Pencil size={16} color="#0f172a" />
              <Text className="ml-1 font-semibold">Editar</Text>
            </Button>
            <Button size="sm" className="flex-1" onPress={onTentarNovamente}>
              <RefreshCw size={16} color="white" />
              <Text className="ml-1 font-semibold text-primary-foreground">De novo</Text>
            </Button>
          </>
        )}
      </View>
    </View>
  );
}

function PendingCard({
  row,
  lookups,
  onExcluir,
  onTentarNovamente,
  onVerDetalhes,
}: {
  row: PendingRow;
  lookups: Lookups;
  onExcluir: () => void;
  onTentarNovamente: () => void;
  onVerDetalhes: () => void;
}) {
  const { item } = row;
  const temErro = item.status === "error";
  const temIssues = !!item.errorIssues && item.errorIssues.length > 0;
  const cabecalho = resumoCard(row, lookups);

  // Só abastecimento tem edição hoje (form suporta editarClientId). Viagem já
  // tinha; pedágio ainda não.
  const editarRota =
    row.kind === "viagem"
      ? "/nova-viagem"
      : row.kind === "abastecimento"
        ? "/novo-abastecimento"
        : null;

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
      <View className="rounded-2xl border-2 border-border bg-card p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Badge variant="outline">{cabecalho.tipoLabel}</Badge>
            </View>
            <Text className="mt-1.5 text-lg font-bold text-foreground" numberOfLines={1}>
              {cabecalho.titulo}
            </Text>
            <Text
              className="mt-0.5 text-base font-medium text-muted-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {cabecalho.subtitulo}
            </Text>
          </View>
          <Badge variant={temErro ? "destructive" : "warning"}>
            {temErro
              ? item.errorStatus
                ? `Erro ${item.errorStatus}`
                : `Falhou (${item.attempts})`
              : "Pendente"}
          </Badge>
        </View>

        {cabecalho.linha3 && (
          <Text className="mt-2 text-sm text-muted-foreground" numberOfLines={2}>
            {cabecalho.linha3}
          </Text>
        )}

        {temErro && (
          <View className="mt-3 gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <Text className="text-xs font-semibold text-destructive">
              {temIssues ? "Campos com problema:" : "Último erro:"}
            </Text>
            {temIssues ? (
              <View className="gap-0.5">
                {item.errorIssues!.map((issue, idx) => (
                  <Text
                    key={`${issue.path}-${idx}`}
                    className="text-xs text-destructive"
                  >
                    • {labelDoCampo(issue.path)}: {frasePorCodigo(issue.code, issue.message)}
                  </Text>
                ))}
              </View>
            ) : (
              <Text className="text-xs text-destructive" numberOfLines={3}>
                {item.errorMsg ?? "Erro desconhecido."}
              </Text>
            )}
          </View>
        )}

        <View className="mt-3 gap-2">
          <Button variant="outline" size="sm" onPress={onVerDetalhes}>
            Ver detalhes
          </Button>
          {temErro && (
            <View className="flex-row gap-2">
              {editarRota && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push({
                      pathname: editarRota,
                      params: { editarClientId: item.clientId },
                    });
                  }}
                >
                  <Pencil size={16} color="#0f172a" />
                  <Text className="ml-1 font-semibold">Editar</Text>
                </Button>
              )}
              <Button size="sm" className="flex-1" onPress={onTentarNovamente}>
                <RefreshCw size={16} color="white" />
                <Text className="ml-1 font-semibold text-primary-foreground">
                  Tentar de novo
                </Text>
              </Button>
            </View>
          )}
        </View>
      </View>
    </Swipeable>
  );
}

/** Monta o cabeçalho (tipo, título, subtítulo, linha extra) de cada card. */
function resumoCard(
  row: PendingRow,
  lookups: Lookups,
): { tipoLabel: string; titulo: string; subtitulo: string; linha3?: string } {
  const p = row.item.payload as Record<string, string | number | undefined>;
  const placa = lookups?.v.get(String(p.veiculoId))?.placa;

  if (row.kind === "viagem") {
    const cliente = lookups?.o.get(String(p.clienteId))?.nome;
    const material = lookups?.m.get(String(p.materialId))?.nome;
    const carga = lookups?.l.get(String(p.localCargaId))?.nome;
    const descarga = lookups?.l.get(String(p.localDescargaId))?.nome;
    return {
      tipoLabel: "Viagem",
      titulo: cliente ?? "Cliente ?",
      subtitulo: `${fmtData(String(p.data ?? ""))}${placa ? ` · ${placa}` : ""}`,
      linha3: `${material ?? "material ?"} · ticket ${String(p.ticket ?? "")} · ${String(p.toneladas ?? "")} t\n${carga ?? "carga ?"} → ${descarga ?? "descarga ?"}`,
    };
  }

  if (row.kind === "pedagio") {
    return {
      tipoLabel: "Pedágio",
      titulo: String(p.pracaPedagio ?? "Praça ?"),
      subtitulo: `${fmtData(String(p.data ?? ""))}${placa ? ` · ${placa}` : ""}`,
      linha3: `R$ ${fmtValor(p.valor)}`,
    };
  }

  // abastecimento
  const empresa = lookups?.e.get(String(p.empresaId))?.nome;
  const tipoComb = TIPO_COMBUSTIVEL_LABEL[String(p.tipo)] ?? String(p.tipo ?? "");
  return {
    tipoLabel: "Abastecimento",
    titulo: placa ? `${placa}${empresa ? ` · ${empresa}` : ""}` : (empresa ?? "Abastecimento"),
    subtitulo: `${fmtData(String(p.data ?? ""))} · ${tipoComb}`,
    linha3: `${String(p.litros ?? "")} L · odômetro ${String(p.odometro ?? "")} km${p.emComboio ? " · em comboio" : p.valorTotal != null ? ` · R$ ${fmtValor(p.valorTotal)}` : ""}`,
  };
}

/** Campos comuns a todo item do outbox, pro modal de detalhe. */
type PendingComum = {
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  lastTriedAt?: number;
  errorMsg?: string;
  errorStatus?: number;
  errorIssues?: ZodIssueSaved[];
  fotoUri?: string;
};

function DetalheModal({
  item,
  onClose,
}: {
  item: PendingComum | null;
  onClose: () => void;
}) {
  if (!item) return null;
  const payloadJson = JSON.stringify(item.payload, null, 2);
  const temIssues = !!item.errorIssues && item.errorIssues.length > 0;

  return (
    <Modal
      visible={!!item}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <Text className="text-lg font-bold">Detalhes do envio</Text>
          <Pressable
            onPress={onClose}
            className="h-10 w-10 items-center justify-center rounded-full active:bg-muted"
          >
            <Text className="text-2xl">×</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}
        >
          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase text-muted-foreground">
              Status
            </Text>
            <Text className="text-base">
              {item.status} ·{" "}
              {item.attempts === 0
                ? "nenhuma tentativa"
                : `${item.attempts} tentativa${item.attempts === 1 ? "" : "s"}`}
              {item.errorStatus ? ` · HTTP ${item.errorStatus}` : ""}
            </Text>
            {item.lastTriedAt && (
              <Text className="text-xs text-muted-foreground">
                Última tentativa: {new Date(item.lastTriedAt).toLocaleString("pt-BR")}
              </Text>
            )}
          </View>

          {item.errorMsg && (
            <View className="gap-1">
              <Text className="text-xs font-semibold uppercase text-muted-foreground">
                Erro do servidor
              </Text>
              <View className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <Text className="text-sm text-destructive">{item.errorMsg}</Text>
              </View>
            </View>
          )}

          {temIssues && (
            <View className="gap-1">
              <Text className="text-xs font-semibold uppercase text-muted-foreground">
                Issues (Zod)
              </Text>
              <View className="gap-2">
                {item.errorIssues!.map((issue, idx) => (
                  <View
                    key={`${issue.path}-${idx}`}
                    className="rounded-lg border border-border bg-muted/30 p-3"
                  >
                    <Text className="font-mono text-sm font-semibold">
                      {issue.path || "(raiz)"}
                    </Text>
                    <Text className="mt-0.5 text-xs text-muted-foreground">
                      code: <Text className="font-mono">{issue.code}</Text>
                    </Text>
                    <Text className="mt-0.5 text-sm">{issue.message}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View className="gap-1">
            <Text className="text-xs font-semibold uppercase text-muted-foreground">
              Payload enviado
            </Text>
            <View className="rounded-lg border border-border bg-muted/30 p-3">
              <Text
                className="font-mono text-xs"
                style={{ fontFamily: "Courier" }}
                selectable
              >
                {payloadJson}
              </Text>
            </View>
          </View>

          {item.fotoUri && (
            <View className="gap-1">
              <Text className="text-xs font-semibold uppercase text-muted-foreground">
                Foto local
              </Text>
              <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                {item.fotoUri}
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function fmtData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

function fmtValor(v: unknown): string {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (Number.isNaN(n)) return String(v ?? "");
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
