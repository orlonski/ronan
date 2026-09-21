import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Check, ChevronRight, Clock, CloudOff, PenLine, TriangleAlert } from "lucide-react-native";
import { usePendingPonto } from "@/hooks/use-pending-ponto";
import { usePontoHoje } from "@/lib/queries";
import { enqueuePonto } from "@/lib/sync";
import { hojeISO } from "@/lib/datetime";
import { EmptyState } from "@/components/empty-state";

/**
 * A ABA DO PONTO — a tela de quem é registrado em carteira.
 *
 * ⚠️ Nasceu como um card espremido na home e estava errado, na palavra do
 * dono: "que porcaria de UI". E o erro não era de estilo — era de lugar. Pra
 * quem é CLT, bater o ponto é a coisa que ele abre o app pra fazer, duas a
 * quatro vezes por dia, todo dia. Isso é uma aba, não um aviso entre
 * catorze blocos.
 *
 * ⚠️ A regra do registro não mudou: o botão grava UM INSTANTE. Não pergunta
 * se é entrada, almoço ou saída, e a lista de batidas não rotula nenhuma.
 * Quem decide o que cada uma é, é a apuração — é o que permite obedecer o
 * art. 82, IV da Portaria 671 e é o que faz o dedão não ter o que errar.
 */

const COR_OK = "#1DA54F";
const COR_AVISO = "#B4501A";
const COR_ERRO = "#EB1414";

export default function PontoTab() {
  const router = useRouter();
  const qc = useQueryClient();
  const dia = hojeISO();
  const { data, refetch } = usePontoHoje(dia);
  const [batendo, setBatendo] = useState(false);
  const [agora, setAgora] = useState(() => relogio());
  const [atualizando, setAtualizando] = useState(false);

  // O relógio anda na tela. Não é enfeite: ele mostra QUE HORAS vão ser
  // gravadas, antes do toque — e é o que evita a pergunta "bateu que horas?".
  useEffect(() => {
    const t = setInterval(() => setAgora(relogio()), 10_000);
    return () => clearInterval(t);
  }, []);

  const naFila = usePendingPonto();
  const doDia = naFila.filter((i) => i.payload.dia === dia);
  const falhou = doDia.find((i) => i.status === "error");

  const batidas = [
    ...(data?.marcacoes ?? []).map((m) => ({ hora: horaBR(m.marcadoEm), enviada: true })),
    ...doDia.map((i) => ({ hora: horaBR(i.payload.marcadoEm), enviada: false })),
  ].sort((a, b) => a.hora.localeCompare(b.hora));

  async function bater() {
    setBatendo(true);
    const marcadoEm = new Date().toISOString();

    // GPS é EVIDÊNCIA, nunca porteiro: usa a permissão que já existe, nunca
    // pede na hora, e sem coordenada registra igual.
    let coords: { latitude: number; longitude: number; precisao?: number } | undefined;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          precisao: pos.coords.accuracy ?? undefined,
        };
      }
    } catch {
      /* sem GPS o registro vale do mesmo jeito */
    }

    await enqueuePonto({ marcadoEm, dia, ...coords });
    void qc.invalidateQueries({ queryKey: ["ponto-hoje"] });
    setBatendo(false);
  }

  return (
    <View className="flex-1 bg-background">
      <SafeAreaView edges={["top"]} className="bg-brand">
        <View className="px-5 pb-5 pt-2">
          <Text className="text-2xl font-extrabold tracking-tight text-white">Meu ponto</Text>
          <Text className="text-sm font-medium text-white/80" numberOfLines={1}>
            {data?.funcionario
              ? `${data.funcionario.cargo ?? "Registrado"}${data.funcionario.empresa ? ` · ${data.funcionario.empresa}` : ""}`
              : "Carregando…"}
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={() => {
              setAtualizando(true);
              void refetch().finally(() => setAtualizando(false));
            }}
          />
        }
      >
        {/* A hora que vai ser gravada, do tamanho que dá pra ler no sol. */}
        <View className="items-center">
          <Text className="text-6xl font-bold tracking-tight text-foreground">{agora}</Text>
          <Text className="mt-1 text-base text-muted-foreground">{dataPorExtenso(dia)}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Registrar ponto agora"
          disabled={batendo}
          onPress={() => void bater()}
          className="items-center justify-center rounded-3xl bg-brand active:opacity-80"
          style={{ height: 140 }}
        >
          <Text className="text-3xl font-bold text-brand-foreground">
            {batendo ? "Registrando…" : "Registrar ponto"}
          </Text>
          <Text className="mt-1 text-base text-brand-foreground/80">
            {batidas.length === 0
              ? "primeira batida de hoje"
              : `${batidas.length + 1}ª batida de hoje`}
          </Text>
        </Pressable>

        {falhou ? (
          <View className="gap-2 rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-4">
            <View className="flex-row items-center gap-2">
              <TriangleAlert size={22} color={COR_ERRO} />
              <Text className="flex-1 text-base font-bold text-destructive">
                Uma batida não chegou no escritório
              </Text>
            </View>
            <Text className="text-sm text-foreground">
              {falhou.errorMsg ?? "Está guardada aqui no celular e não se perde."}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/pendentes")}
              className="mt-1 items-center rounded-xl border-2 border-destructive/50 py-3"
            >
              <Text className="text-base font-semibold text-destructive">Resolver agora</Text>
            </Pressable>
          </View>
        ) : doDia.length > 0 ? (
          <View className="flex-row items-center gap-3 rounded-2xl border-2 border-warning/60 bg-warning/10 p-4">
            <CloudOff size={24} color={COR_AVISO} />
            <Text className="flex-1 text-base text-foreground">
              {doDia.length === 1 ? "1 batida guardada" : `${doDia.length} batidas guardadas`} aqui.
              Chega no escritório quando o sinal voltar.
            </Text>
          </View>
        ) : batidas.length > 0 ? (
          <View className="flex-row items-center gap-3 rounded-2xl border-2 border-success/50 bg-success/10 p-4">
            <Check size={24} color={COR_OK} strokeWidth={3} />
            <Text className="flex-1 text-base text-foreground">
              Tudo registrado no escritório.
            </Text>
          </View>
        ) : null}

        {/* As batidas de hoje, em ordem e SEM rótulo: a tela não decide o que
            cada uma é. */}
        <View className="gap-2">
          <Text className="text-base font-semibold text-foreground">Hoje</Text>
          {batidas.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="Nenhuma batida ainda"
              description="Toque no botão quando começar, na saída para o intervalo, na volta e no fim."
            />
          ) : (
            <View className="gap-2">
              {batidas.map((b, i) => (
                <View
                  key={i}
                  className={`flex-row items-center justify-between rounded-2xl border-2 px-4 py-3 ${
                    b.enviada ? "border-success/40 bg-success/5" : "border-warning/60 bg-warning/10"
                  }`}
                >
                  <Text className="text-2xl font-bold text-foreground">{b.hora}</Text>
                  {b.enviada ? (
                    <Check size={22} color={COR_OK} strokeWidth={3} />
                  ) : (
                    <CloudOff size={22} color={COR_AVISO} />
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        <View className="gap-2">
          <Atalho
            titulo="Meu espelho do mês"
            descricao="Os dias, as horas e o saldo — pra você conferir"
            onPress={() => router.push("/meu-espelho")}
          />
          <Atalho
            titulo="Pedir correção"
            descricao="Esqueceu de bater, ou bateu na hora errada"
            icone
            onPress={() => router.push("/corrigir-ponto")}
          />
        </View>

        <Text className="text-center text-xs text-muted-foreground">
          As batidas são suas e ninguém pode apagá-las — nem a empresa, nem nós. O que muda a
          conta é a correção, e ela fica registrada com autor e motivo.
        </Text>
      </ScrollView>
    </View>
  );
}

function Atalho({
  titulo,
  descricao,
  onPress,
  icone,
}: {
  titulo: string;
  descricao: string;
  onPress: () => void;
  icone?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl border-2 border-border p-4 active:opacity-75"
    >
      {icone && <PenLine size={22} />}
      <View className="flex-1">
        <Text className="text-base font-semibold text-foreground">{titulo}</Text>
        <Text className="text-sm text-muted-foreground">{descricao}</Text>
      </View>
      <ChevronRight size={20} color="#64748b" />
    </Pressable>
  );
}

/** Hora de Brasília, não a do fuso que o aparelho acha que tem. */
function relogio(): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function horaBR(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function dataPorExtenso(ymd: string): string {
  const [a, m, d] = ymd.split("-").map(Number);
  const semana = DIAS[new Date(Date.UTC(a!, (m ?? 1) - 1, d ?? 1)).getUTCDay()];
  return `${semana}, ${d} de ${MESES[(m ?? 1) - 1]}`;
}
