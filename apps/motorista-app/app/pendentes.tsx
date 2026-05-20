import { useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { CloudOff, Pencil, RefreshCw, Trash2 } from "lucide-react-native";
import {
  Alert,
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
import { type PendingViagem } from "@/db/database";
import { usePendingViagens } from "@/hooks/use-pending-viagens";
import {
  descartarViagemPendente,
  drain,
  tentarNovamenteViagemPendente,
} from "@/lib/sync";
import { useCatalogos } from "@/lib/queries";
import { frasePorCodigo, labelDoCampo } from "@/lib/validation";

export default function Pendentes() {
  const lista = usePendingViagens();
  const cat = useCatalogos();
  const [detalheItem, setDetalheItem] = useState<PendingViagem | null>(null);

  // Helpers de lookup por id no catalogo
  const lookups = useMemo(() => {
    if (!cat.data) return null;
    const v = new Map(cat.data.veiculos.map((x) => [x.id, x]));
    const o = new Map(cat.data.clientes.map((x) => [x.id, x]));
    const m = new Map(cat.data.materiais.map((x) => [x.id, x]));
    const l = new Map(cat.data.locais.map((x) => [x.id, x]));
    return { v, o, m, l };
  }, [cat.data]);

  function confirmarExcluir(item: PendingViagem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Excluir esta viagem?",
      "A viagem ainda não foi enviada. Apagar agora não pode ser desfeito.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            await descartarViagemPendente(item.clientId);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
  }

  async function onTentarNovamente(item: PendingViagem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await tentarNovamenteViagemPendente(item.clientId);
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Aguardando internet" />

        <FlatList<PendingViagem>
          data={lista}
          keyExtractor={(v) => v.clientId}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
          ListHeaderComponent={
            lista.length > 0 ? (
              <View className="mb-2 gap-3">
                <Text className="text-sm text-muted-foreground">
                  {lista.length} {lista.length === 1 ? "viagem" : "viagens"} aguardando
                  envio. Arraste pra esquerda pra excluir, ou toque em
                  &quot;Sincronizar&quot; pra tentar enviar agora.
                </Text>
                <Button onPress={() => void drain()}>Sincronizar agora</Button>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={CloudOff}
              title="Tudo sincronizado"
              description="Não tem viagens aguardando internet."
            />
          }
          renderItem={({ item }) => (
            <PendingCard
              item={item}
              lookups={lookups}
              onExcluir={confirmarExcluir}
              onTentarNovamente={onTentarNovamente}
              onVerDetalhes={() => setDetalheItem(item)}
            />
          )}
        />

        <DetalheModal
          item={detalheItem}
          onClose={() => setDetalheItem(null)}
        />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

type Lookups = {
  v: Map<string, { id: string; placa: string; modelo: string | null }>;
  o: Map<string, { id: string; nome: string }>;
  m: Map<string, { id: string; nome: string }>;
  l: Map<string, { id: string; nome: string; cidade: string; uf: string }>;
} | null;

function PendingCard({
  item,
  lookups,
  onExcluir,
  onTentarNovamente,
  onVerDetalhes,
}: {
  item: PendingViagem;
  lookups: Lookups;
  onExcluir: (item: PendingViagem) => void;
  onTentarNovamente: (item: PendingViagem) => void;
  onVerDetalhes: () => void;
}) {
  const p = item.payload as Record<string, string | number | undefined>;
  const placa = lookups?.v.get(String(p.veiculoId))?.placa;
  const cliente = lookups?.o.get(String(p.clienteId))?.nome;
  const material = lookups?.m.get(String(p.materialId))?.nome;
  const carga = lookups?.l.get(String(p.localCargaId))?.nome;
  const descarga = lookups?.l.get(String(p.localDescargaId))?.nome;
  const data = String(p.data ?? "");

  const temErro = item.status === "error";
  const temIssues = !!item.errorIssues && item.errorIssues.length > 0;

  return (
    <Swipeable
      renderRightActions={() => (
        <View className="ml-2 flex-row items-stretch">
          <Button
            variant="destructive"
            className="h-full w-24 rounded-2xl"
            onPress={() => onExcluir(item)}
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
            <Text className="text-lg font-bold text-foreground" numberOfLines={1}>
              {cliente ?? "Cliente ?"}
            </Text>
            <Text
              className="mt-0.5 text-base font-medium text-muted-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {fmtData(data)}{placa ? ` · ${placa}` : ""}
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

        <Text className="mt-2 text-sm text-muted-foreground" numberOfLines={1}>
          {material} · ticket {String(p.ticket ?? "")} · {String(p.toneladas ?? "")} t
        </Text>
        {(carga || descarga) && (
          <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={2}>
            {carga ?? "carga ?"} → {descarga ?? "descarga ?"}
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
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({
                    pathname: "/nova-viagem",
                    params: { editarClientId: item.clientId },
                  });
                }}
              >
                <Pencil size={16} color="#0f172a" />
                <Text className="ml-1 font-semibold">Editar</Text>
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onPress={() => onTentarNovamente(item)}
              >
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

function DetalheModal({
  item,
  onClose,
}: {
  item: PendingViagem | null;
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
