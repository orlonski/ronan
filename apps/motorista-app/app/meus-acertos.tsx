import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, Wallet } from "lucide-react-native";
import type { AcertoDoMotorista } from "@ronan/shared-types";
import { ITEM_ACERTO_LABEL } from "@ronan/shared-types";
import { ScreenHeader } from "@/components/screen-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";

/**
 * O extrato: o que a empresa apurou que deve a ele.
 *
 * Aqui só chega acerto FECHADO ou PAGO — rascunho do escritório não aparece,
 * porque mostrar um número que ainda vai mudar geraria a pior conversa
 * possível ("ontem estava R$ 4.200").
 *
 * Abrir a tela carimba que ele viu. É o que separa um acerto combinado de um
 * acerto imposto: se ele nunca abriu, ninguém pode dizer que ele concordou.
 */
export default function MeusAcertos() {
  const [atualizando, setAtualizando] = useState(false);

  const acertos = useQuery({
    queryKey: ["m", "acertos"],
    queryFn: () => api.meusAcertos(),
    // Cache-first como o resto do app: ele abre o extrato no posto, com 4G ruim.
    staleTime: 60_000,
  });

  // Carimba o mais recente que ele ainda não tinha visto. `void` de propósito:
  // falhar em marcar não pode atrapalhar a leitura do extrato.
  useEffect(() => {
    const primeiro = acertos.data?.[0];
    if (primeiro) void api.marcarAcertoVisto(primeiro.id).catch(() => {});
  }, [acertos.data]);

  const recarregar = useCallback(async () => {
    setAtualizando(true);
    await acertos.refetch();
    setAtualizando(false);
  }, [acertos]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScreenHeader title="Meus acertos" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={
          // Só no gesto: recarga automática prende o spinner no iOS.
          <RefreshControl refreshing={atualizando} onRefresh={recarregar} />
        }
      >
        {acertos.isLoading && (
          <Text className="py-8 text-center text-muted-foreground">Carregando…</Text>
        )}

        {!acertos.isLoading && (acertos.data?.length ?? 0) === 0 && (
          <EmptyState
            icon={HandCoins}
            title="Nenhum acerto ainda"
            description="Quando a empresa fechar o acerto do período, ele aparece aqui com tudo detalhado."
          />
        )}

        {acertos.data?.map((a) => (
          <AcertoCard key={a.id} acerto={a} />
        ))}

        {(acertos.data?.length ?? 0) > 0 && (
          <Text className="px-1 text-xs leading-5 text-muted-foreground">
            Não bateu com a sua conta? Fale com a empresa antes de receber — cada linha aqui
            aponta a viagem, o pedágio ou o abastecimento que gerou o valor.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function brl(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : v;
}

function periodo(inicio: string, fim: string): string {
  const f = (d: string) => {
    const [a, m, dia] = d.slice(0, 10).split("-");
    return `${dia}/${m}`;
  };
  return `${f(inicio)} a ${f(fim)}`;
}

function AcertoCard({ acerto }: { acerto: AcertoDoMotorista }) {
  const [aberto, setAberto] = useState(false);
  const creditos = acerto.itens.filter((i) => Number(i.valor) >= 0);
  const debitos = acerto.itens.filter((i) => Number(i.valor) < 0);
  const pago = acerto.status === "PAGO";

  return (
    <Card>
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-sm text-muted-foreground">
            {periodo(acerto.periodoInicio, acerto.periodoFim)}
          </Text>
          <Text className="mt-0.5 text-3xl font-bold text-foreground">{brl(acerto.liquido)}</Text>
        </View>
        <View
          className={`rounded-full px-3 py-1 ${pago ? "bg-success" : "bg-warning"}`}
        >
          <Text className={`text-xs font-bold ${pago ? "text-white" : "text-foreground"}`}>
            {pago ? "Pago" : "A receber"}
          </Text>
        </View>
      </View>

      {pago && acerto.pagoEm && (
        <View className="mt-2 flex-row items-center gap-1.5">
          <Wallet size={14} color="#16a34a" />
          <Text className="text-sm text-muted-foreground">
            Pago em {new Date(acerto.pagoEm).toLocaleDateString("pt-BR")}
            {acerto.pagoMeio ? ` · ${acerto.pagoMeio}` : ""}
          </Text>
        </View>
      )}

      <View className="mt-3 flex-row gap-4 border-t border-border pt-3">
        <View className="flex-1">
          <Text className="text-xs text-muted-foreground">Você ganhou</Text>
          <Text className="text-base font-bold text-foreground">{brl(acerto.creditos)}</Text>
        </View>
        {Number(acerto.debitos) > 0 && (
          <View className="flex-1">
            <Text className="text-xs text-muted-foreground">Descontado</Text>
            <Text className="text-base font-bold text-destructive">− {brl(acerto.debitos)}</Text>
          </View>
        )}
      </View>

      <Text
        onPress={() => setAberto((v) => !v)}
        className="mt-3 text-sm font-semibold text-primary"
      >
        {aberto ? "Esconder detalhes" : `Ver as ${acerto.itens.length} linhas`}
      </Text>

      {aberto && (
        <View className="mt-2 gap-3">
          <Linhas titulo="Ganhos e reembolsos" itens={creditos} />
          {debitos.length > 0 && <Linhas titulo="Descontos" itens={debitos} />}
        </View>
      )}
    </Card>
  );
}

function Linhas({
  titulo,
  itens,
}: {
  titulo: string;
  itens: AcertoDoMotorista["itens"];
}) {
  if (itens.length === 0) return null;
  return (
    <View className="gap-1">
      <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </Text>
      {itens.map((i) => {
        const negativo = Number(i.valor) < 0;
        return (
          <View key={i.id} className="flex-row items-start justify-between gap-3 py-1">
            <View className="flex-1">
              <Text className="text-sm text-foreground">{i.descricao}</Text>
              <Text className="text-xs text-muted-foreground">{ITEM_ACERTO_LABEL[i.tipo]}</Text>
              {/* O motivo do desconto é o que ele mais precisa ler. */}
              {i.motivo && (
                <Text className="mt-0.5 text-xs italic text-muted-foreground">{i.motivo}</Text>
              )}
            </View>
            <Text
              className={`text-sm font-semibold ${negativo ? "text-destructive" : "text-foreground"}`}
            >
              {negativo ? "− " : ""}
              {brl(String(Math.abs(Number(i.valor))))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
