import { useEffect, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { Activity, AlertTriangle, Save, Square, Trash2 } from "lucide-react-native";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { clearViagemAndamento } from "@/lib/tracking-storage";
import {
  cancelarTracking,
  isTrackingAtivo,
  pararTracking,
  useViagemAndamento,
} from "@/lib/tracking";

export default function ViagemAndamentoScreen() {
  const { data, resumo } = useViagemAndamento(true);
  const [parando, setParando] = useState(false);
  // null = ainda checando; false = órfão (storage tem mas task parou)
  const [taskAtiva, setTaskAtiva] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void isTrackingAtivo().then((ok) => {
      if (alive) setTaskAtiva(ok);
    });
    return () => {
      alive = false;
    };
  }, [data?.id]);

  async function finalizar() {
    if (!resumo) return;
    setParando(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      await pararTracking();
      // Navega pra Nova Viagem com os dados do tracking nos params (JSON serializado)
      router.replace({
        pathname: "/nova-viagem",
        params: {
          fromTracking: "1",
          trackingData: JSON.stringify({
            id: resumo.id,
            iniciadoEm: resumo.iniciadoEm,
            kmReal: resumo.kmReal.toFixed(2),
            pontos: resumo.pontos,
          }),
        },
      });
    } catch (err) {
      Alert.alert("Erro", (err as Error).message ?? "Falha ao finalizar.");
      setParando(false);
    }
  }

  function confirmarCancelar() {
    Alert.alert(
      "Descartar viagem?",
      "Os pontos GPS capturados serão apagados. Quer mesmo descartar?",
      [
        { text: "Não", style: "cancel" },
        {
          text: "Descartar",
          style: "destructive",
          onPress: async () => {
            void Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Warning,
            );
            await cancelarTracking();
            router.back();
          },
        },
      ],
    );
  }

  if (!data) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator />
        <Text className="mt-4 text-base text-muted-foreground">
          Iniciando captura GPS…
        </Text>
      </SafeAreaView>
    );
  }

  const region =
    data.pontos.length > 0
      ? {
          latitude: data.pontos[data.pontos.length - 1].lat,
          longitude: data.pontos[data.pontos.length - 1].lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }
      : undefined;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Viagem em andamento" />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {/* Banner: 6h+ sem novo ponto (provavelmente parou mas esqueceu) */}
        {taskAtiva && horasSemPonto(data) >= 6 && (
          <View className="rounded-2xl border-2 border-warning bg-warning/15 p-4">
            <View className="flex-row items-center gap-2">
              <AlertTriangle size={18} color="#b45309" />
              <Text className="text-xs font-bold uppercase tracking-wider text-warning-foreground">
                Sem GPS há {horasSemPonto(data).toFixed(0)}h
              </Text>
            </View>
            <Text className="mt-2 text-base text-foreground">
              Provavelmente você esqueceu de finalizar. Toque em "Finalizar
              viagem" pra salvar agora.
            </Text>
          </View>
        )}

        {/* Banner de tracking órfão — task parou mas storage tem dados */}
        {taskAtiva === false && (
          <View className="rounded-2xl border-2 border-warning/40 bg-warning/15 p-4">
            <View className="flex-row items-center gap-2">
              <AlertTriangle size={18} color="#b45309" />
              <Text className="text-xs font-bold uppercase tracking-wider text-warning-foreground">
                Tracking parado
              </Text>
            </View>
            <Text className="mt-2 text-base text-foreground">
              A captura GPS foi interrompida (sistema ou voce). Voce tem{" "}
              {data.pontos.length} pontos não salvos. O que fazer?
            </Text>
          </View>
        )}

        {/* Card principal: KM + tempo + velocidade */}
        <View
          className={
            taskAtiva === false
              ? "rounded-2xl border-2 border-border bg-card p-5"
              : "rounded-2xl border-2 border-primary/30 bg-primary/10 p-5"
          }
        >
          <View className="flex-row items-center gap-2">
            <Activity size={18} color={taskAtiva === false ? "#64748b" : "#ea580c"} />
            <Text
              className={
                taskAtiva === false
                  ? "text-xs font-bold uppercase tracking-wider text-muted-foreground"
                  : "text-xs font-bold uppercase tracking-wider text-primary"
              }
            >
              {taskAtiva === false ? "Capturado" : "Capturando GPS"}
            </Text>
          </View>
          <Text
            className="mt-2 text-5xl font-extrabold text-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {resumo?.kmReal.toFixed(2) ?? "0,00"} km
          </Text>
          <View className="mt-3 flex-row gap-6">
            <Stat
              label="tempo"
              value={fmtDuracao(resumo?.duracaoMin ?? 0)}
            />
            <Stat
              label="vel. média"
              value={`${(resumo?.velocidadeMediaKmh ?? 0).toFixed(0)} km/h`}
            />
            <Stat
              label="pontos"
              value={String(data.pontos.length)}
            />
          </View>
        </View>

        {/* Mini-mapa do trajeto */}
        {region && data.pontos.length >= 2 && (
          <View
            className="overflow-hidden rounded-2xl border-2 border-border"
            style={{ height: 280 }}
          >
            <MapView
              provider={PROVIDER_GOOGLE}
              style={{ flex: 1 }}
              initialRegion={region}
              showsUserLocation
              followsUserLocation
            >
              <Polyline
                coordinates={data.pontos.map((p) => ({
                  latitude: p.lat,
                  longitude: p.lng,
                }))}
                strokeColor="#ea580c"
                strokeWidth={4}
              />
              <Marker
                coordinate={{
                  latitude: data.pontos[0].lat,
                  longitude: data.pontos[0].lng,
                }}
                pinColor="green"
                title="Início"
              />
            </MapView>
          </View>
        )}

        {data.pontos.length < 2 && (
          <View className="rounded-2xl border-2 border-border bg-card p-4">
            <Text className="text-base text-muted-foreground">
              Aguardando os primeiros pontos GPS… Mantenha o app instalado e o
              celular ligado. O mapa aparece após andar alguns metros.
            </Text>
          </View>
        )}

        {/* Botões */}
        <Button
          variant="default"
          size="lg"
          onPress={finalizar}
          loading={parando}
          disabled={parando}
        >
          {taskAtiva === false ? (
            <Save size={20} color="white" />
          ) : (
            <Square size={20} color="white" />
          )}
          <Text className="text-base font-bold text-primary-foreground">
            {taskAtiva === false ? "Salvar agora" : "Finalizar viagem"}
          </Text>
        </Button>
        <Button variant="ghost" onPress={confirmarCancelar} disabled={parando}>
          <Trash2 size={18} color="#dc2626" />
          <Text className="text-sm font-medium text-destructive">
            Descartar viagem
          </Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
      <Text
        className="mt-0.5 text-lg font-bold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}

function horasSemPonto(data: { pontos: { capturadoEm: string }[]; iniciadoEm: string }): number {
  const ultimoTs =
    data.pontos.length > 0
      ? new Date(data.pontos[data.pontos.length - 1]!.capturadoEm).getTime()
      : new Date(data.iniciadoEm).getTime();
  return (Date.now() - ultimoTs) / (1000 * 60 * 60);
}

function fmtDuracao(min: number): string {
  if (min < 60) return `${min.toFixed(0)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h ${m.toString().padStart(2, "0")}min`;
}
