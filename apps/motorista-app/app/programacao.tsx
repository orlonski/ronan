import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, Package } from "lucide-react-native";
import type { ViagemProgramada } from "@ronan/shared-types";
import { ScreenHeader } from "@/components/screen-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import { hojeISO, somarDiasISO } from "@/lib/datetime";

/**
 * A programação: o que o escritório combinou que ele vai levar.
 *
 * É a primeira caixa de entrada de TRABALHO do app — até aqui ele só reportava
 * o que já tinha feito. Só chega o que foi publicado; o quadro em rascunho é do
 * escritório, e ver uma viagem que some depois seria pior que não ver nada.
 */
export default function Programacao() {
  const queryClient = useQueryClient();
  const [atualizando, setAtualizando] = useState(false);

  const lista = useQuery({
    queryKey: ["m", "programacao"],
    queryFn: () => api.minhaProgramacao(),
    staleTime: 60_000,
  });

  const recarregar = useCallback(async () => {
    setAtualizando(true);
    await lista.refetch();
    setAtualizando(false);
  }, [lista]);

  const porDia = agruparPorDia(lista.data ?? []);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScreenHeader title="Minha programação" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={recarregar} />}
      >
        {lista.isLoading && (
          <Text className="py-8 text-center text-muted-foreground">Carregando…</Text>
        )}

        {!lista.isLoading && (lista.data?.length ?? 0) === 0 && (
          <EmptyState
            icon={CalendarDays}
            title="Nada programado"
            description="Quando o escritório montar seu dia, as viagens aparecem aqui. Você continua podendo lançar viagem normalmente, com ou sem programação."
          />
        )}

        {porDia.map(([dia, itens]) => (
          <View key={dia} className="gap-2">
            <Text className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {rotuloDia(dia)}
            </Text>
            {itens.map((p) => (
              <ItemProgramado
                key={p.id}
                p={p}
                onRespondeu={() => queryClient.invalidateQueries({ queryKey: ["m", "programacao"] })}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function agruparPorDia(itens: ViagemProgramada[]): [string, ViagemProgramada[]][] {
  const mapa = new Map<string, ViagemProgramada[]>();
  for (const i of itens) {
    mapa.set(i.dataPrevista, [...(mapa.get(i.dataPrevista) ?? []), i]);
  }
  return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function rotuloDia(iso: string): string {
  // Em UTC, depois das 21h de Brasília a viagem de amanhã aparecia como
  // "Hoje" e a de hoje perdia o rótulo — bem na hora em que ele confere a
  // programação do dia seguinte.
  const hoje = hojeISO();
  const amanha = somarDiasISO(hoje, 1);
  if (iso === hoje) return "Hoje";
  if (iso === amanha) return "Amanhã";
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

function ItemProgramado({ p, onRespondeu }: { p: ViagemProgramada; onRespondeu: () => void }) {
  const [enviando, setEnviando] = useState(false);
  // Recusa pede motivo num campo INLINE, não em prompt de modal: o AlertHost
  // abre atrás de tela cheia no Android, e o projeto já pagou por isso.
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const podeResponder = p.status === "PUBLICADA";

  async function aceitar() {
    setEnviando(true);
    try {
      await api.responderProgramacao(p.id, true);
      onRespondeu();
    } finally {
      setEnviando(false);
    }
  }

  async function recusar() {
    // Do outro lado tem um caminhão parado e alguém tentando adivinhar se é
    // quebra, atestado ou se ele só não vai.
    if (motivo.trim().length < 3) return;
    setEnviando(true);
    try {
      await api.responderProgramacao(p.id, false, motivo.trim());
      onRespondeu();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground">
            {p.cliente?.nome ?? "Viagem"}
          </Text>
          {p.material && (
            <View className="mt-1 flex-row items-center gap-1.5">
              <Package size={14} color="#64748b" />
              <Text className="text-sm text-muted-foreground">{p.material.nome}</Text>
            </View>
          )}
        </View>
        {p.janelaInicio && (
          <View className="rounded-lg bg-secondary px-2 py-1">
            <Text className="text-sm font-bold text-secondary-foreground">{p.janelaInicio}</Text>
          </View>
        )}
      </View>

      {(p.localCarga || p.localDescarga) && (
        <View className="mt-3 gap-1.5 border-t border-border pt-3">
          {p.localCarga && (
            <View className="flex-row items-center gap-1.5">
              <MapPin size={14} color="#64748b" />
              <Text className="flex-1 text-sm text-foreground">
                Carrega em {p.localCarga.nome}
                {p.localCarga.cidade ? ` · ${p.localCarga.cidade}` : ""}
              </Text>
            </View>
          )}
          {p.localDescarga && (
            <View className="flex-row items-center gap-1.5">
              <MapPin size={14} color="#16a34a" />
              <Text className="flex-1 text-sm text-foreground">
                Entrega em {p.localDescarga.nome}
                {p.localDescarga.cidade ? ` · ${p.localDescarga.cidade}` : ""}
              </Text>
            </View>
          )}
        </View>
      )}

      {p.observacao && (
        <Text className="mt-2 text-sm italic text-muted-foreground">{p.observacao}</Text>
      )}

      {podeResponder && !recusando && (
        <View className="mt-3 flex-row gap-2">
          {/* Verde confirma, contorno recusa — semáforo do padrão de botões.
              O rótulo é o verbo do que acontece, nunca "Sim/Não". */}
          <Button
            variant="success"
            className="flex-1"
            disabled={enviando}
            onPress={() => void aceitar()}
          >
            Pode contar comigo
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={enviando}
            onPress={() => setRecusando(true)}
          >
            Não vou conseguir
          </Button>
        </View>
      )}

      {podeResponder && recusando && (
        <View className="mt-3 gap-2">
          <Text className="text-sm text-foreground">
            O que aconteceu? O escritório precisa saber pra remanejar.
          </Text>
          <Input
            value={motivo}
            onChangeText={setMotivo}
            placeholder="ex: caminhão na oficina"
            autoFocus
          />
          <View className="flex-row gap-2">
            <Button
              variant="warning"
              className="flex-1"
              disabled={enviando || motivo.trim().length < 3}
              onPress={() => void recusar()}
            >
              Avisar que não vai dar
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              disabled={enviando}
              onPress={() => {
                setRecusando(false);
                setMotivo("");
              }}
            >
              Voltar
            </Button>
          </View>
        </View>
      )}

      {p.status === "ACEITA" && (
        <Text className="mt-3 text-sm font-semibold text-success">Você confirmou essa viagem</Text>
      )}
      {p.status === "RECUSADA" && (
        <Text className="mt-3 text-sm text-muted-foreground">
          Você avisou que não daria. O escritório já sabe.
        </Text>
      )}
      {p.status === "CUMPRIDA" && (
        <Text className="mt-3 text-sm font-semibold text-success">Feita ✓</Text>
      )}
      {p.status === "CANCELADA" && (
        <Text className="mt-3 text-sm text-muted-foreground">
          O escritório cancelou essa viagem.
        </Text>
      )}
    </Card>
  );
}
