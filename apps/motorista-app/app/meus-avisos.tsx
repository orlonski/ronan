import { useState } from "react";
import { router, Stack } from "expo-router";
import { CloudOff, Wrench } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { EmptyState } from "@/components/empty-state";
import { RequerCapacidade } from "@/components/requer-capacidade";
import { usePendingProblemas } from "@/hooks/use-pending-problemas";
import { useMeusProblemas, type MeuProblemaVeiculo } from "@/lib/queries";

/**
 * MEUS AVISOS: o que ele avisou do caminhão e o que o escritório decidiu.
 *
 * Existe porque, sem resposta, o aviso parecia cair no vazio — e parceiro que
 * fala e não é ouvido para de avisar (dono, 23/09/2026). O que ainda está na
 * fila do aparelho aparece em cima, como "esperando sinal".
 */
export default function MeusAvisosScreen() {
  return (
    <RequerCapacidade chave="app.problema.avisar" titulo="Meus avisos">
      <Conteudo />
    </RequerCapacidade>
  );
}

type Linha =
  | { tipo: "fila"; clientId: string; placa: string | null; descricao: string; quando: number }
  | { tipo: "servidor"; item: MeuProblemaVeiculo };

function Conteudo() {
  const q = useMeusProblemas();
  const naFila = usePendingProblemas();
  // RefreshControl só no gesto: recarga automática prende o spinner no iOS.
  const [puxando, setPuxando] = useState(false);

  const doServidor = q.data ?? [];
  const jaSubiu = new Set(doServidor.map((p) => p.clientId));
  const linhas: Linha[] = [
    ...naFila
      .filter((p) => !jaSubiu.has(p.clientId))
      .map((p) => ({
        tipo: "fila" as const,
        clientId: p.clientId,
        placa: p.placa,
        descricao: p.descricao,
        quando: p.createdAt,
      })),
    ...doServidor.map((item) => ({ tipo: "servidor" as const, item })),
  ];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Meus avisos do caminhão" />
      <FlatList<Linha>
        data={linhas}
        keyExtractor={(l) => (l.tipo === "fila" ? `fila-${l.clientId}` : l.item.id)}
        contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={puxando}
            onRefresh={async () => {
              setPuxando(true);
              await q.refetch().catch(() => {});
              setPuxando(false);
            }}
          />
        }
        ListEmptyComponent={
          q.isLoading ? null : (
            <View className="gap-4">
              <EmptyState
                icon={Wrench}
                title="Nenhum aviso ainda"
                description="Quando algo estiver errado no caminhão, avise com foto pelo Início."
              />
              <Pressable
                onPress={() => router.replace("/avisar-problema")}
                className="items-center rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
              >
                <Text className="text-base font-bold text-foreground">Avisar um problema</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item: l }) =>
          l.tipo === "fila" ? (
            <View className="gap-1 rounded-2xl border-2 border-border bg-card p-4">
              <View className="flex-row items-center gap-2">
                <CloudOff size={16} color="#b45309" />
                <Text className="text-sm font-semibold text-amber-700">Esperando sinal pra enviar</Text>
              </View>
              <Text className="text-base font-bold text-foreground">{l.placa ?? "Caminhão"}</Text>
              <Text className="text-base text-foreground">{l.descricao}</Text>
              <Text className="text-sm text-muted-foreground">{fmtQuando(l.quando)}</Text>
            </View>
          ) : (
            <CardAviso p={l.item} />
          )
        }
      />
    </SafeAreaView>
  );
}

function CardAviso({ p }: { p: MeuProblemaVeiculo }) {
  const situacao = situacaoDoAviso(p);
  return (
    <View className="gap-1 rounded-2xl border-2 border-border bg-card p-4">
      <Text className={`text-sm font-semibold ${situacao.cor}`}>{situacao.titulo}</Text>
      <Text className="text-base font-bold text-foreground">{p.veiculo?.placa ?? "Caminhão"}</Text>
      <Text className="text-base text-foreground">{p.descricao}</Text>
      {situacao.detalhe ? (
        <Text className="text-sm text-muted-foreground">{situacao.detalhe}</Text>
      ) : null}
      <Text className="text-sm text-muted-foreground">
        Avisado {fmtQuando(new Date(p.avisadoEm).getTime())}
        {p.fotos > 0 ? ` · ${p.fotos} foto${p.fotos > 1 ? "s" : ""}` : ""}
      </Text>
    </View>
  );
}

function situacaoDoAviso(p: MeuProblemaVeiculo): { titulo: string; detalhe?: string; cor: string } {
  if (p.status === "DESCARTADO") {
    return {
      titulo: "O escritório viu — não vira conserto agora",
      detalhe: p.motivoDescarte ? `Motivo: ${p.motivoDescarte}` : undefined,
      cor: "text-muted-foreground",
    };
  }
  if (p.status === "VIROU_MANUTENCAO") {
    const st = p.manutencao?.status;
    if (st === "CONCLUIDA") return { titulo: "Consertado", cor: "text-green-700" };
    if (st === "EM_ANDAMENTO") return { titulo: "Na oficina", cor: "text-green-700" };
    if (st === "CANCELADA") return { titulo: "Conserto cancelado pelo escritório", cor: "text-muted-foreground" };
    return { titulo: "Virou conserto — o escritório vai agendar", cor: "text-green-700" };
  }
  return { titulo: "Chegou no escritório — ainda vão olhar", cor: "text-blue-700" };
}

function fmtQuando(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `em ${dd}/${mm} às ${hh}:${mi}`;
}
