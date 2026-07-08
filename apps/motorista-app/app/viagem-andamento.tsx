import { useEffect, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  Activity,
  AlertTriangle,
  Navigation,
  Save,
  Square,
  Trash2,
} from "lucide-react-native";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MapTrajeto } from "@/components/map-trajeto";
import { BuscarLocalModal } from "@/components/buscar-local-modal";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { showAlert, showConfirm } from "@/lib/alert";
import { abrirNavegacaoExterna } from "@/lib/mapa-externo";
import { useMe, type Local } from "@/lib/queries";
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

  // Navegação até a descarga (só pra quem tem "Iniciar viagem com GPS"). Por ora
  // via Waze/Google (navegação real com voz/recálculo). O mapa/guia in-app está
  // guardado no código (components/guia-navegacao) até dar pra testar num build
  // — ele crashava nativo (react-native-maps) em device e não dava pra reproduzir.
  const me = useMe();
  const podeGuiar = me.data?.podeIniciarViagem ?? false;
  const [destino, setDestino] = useState<Local | null>(null);
  const [buscaAberta, setBuscaAberta] = useState(false);

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
      void showAlert({
        title: "Erro",
        message: (err as Error).message ?? "Falha ao finalizar.",
        variant: "destructive",
      });
      setParando(false);
    }
  }

  async function confirmarCancelar() {
    const ok = await showConfirm({
      title: "Descartar viagem?",
      message: "Os pontos GPS capturados serão apagados. Quer mesmo descartar?",
      confirmLabel: "Descartar",
      cancelLabel: "Não",
      destructive: true,
    });
    if (!ok) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await cancelarTracking();
    router.back();
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
              Provavelmente você esqueceu de finalizar. Toque em
              &quot;Finalizar viagem&quot; pra salvar agora.
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

        {/* Navegar até a descarga (só pra quem tem "Iniciar viagem com GPS") */}
        {podeGuiar && (
          <View className="gap-2 rounded-2xl border-2 border-border bg-card p-4">
            <View className="flex-row items-center gap-2">
              <Navigation size={18} color="#2563eb" />
              <Text className="text-base font-bold text-foreground">
                Navegar até a descarga
              </Text>
            </View>

            {!destino ? (
              <Button variant="outline" onPress={() => setBuscaAberta(true)}>
                <Navigation size={18} color="#2563eb" />
                <Text className="text-sm font-semibold text-foreground">
                  Escolher para onde você vai
                </Text>
              </Button>
            ) : (
              <View className="gap-2">
                <View className="flex-row items-center justify-between gap-2">
                  <Text
                    className="flex-1 text-base font-semibold text-foreground"
                    numberOfLines={2}
                  >
                    → {destino.nome}
                  </Text>
                  <Button variant="ghost" size="sm" onPress={() => setDestino(null)}>
                    <Text className="text-sm font-medium text-muted-foreground">
                      Trocar
                    </Text>
                  </Button>
                </View>

                {destino.lat != null && destino.lng != null ? (
                  <Button
                    size="lg"
                    className="h-16"
                    onPress={() =>
                      void abrirNavegacaoExterna(destino.lat!, destino.lng!)
                    }
                  >
                    <Navigation size={22} color="white" />
                    <Text className="text-base font-bold text-primary-foreground">
                      Navegar no Waze / Mapas
                    </Text>
                  </Button>
                ) : (
                  <Text className="text-sm text-muted-foreground">
                    Esse local não tem coordenadas cadastradas.
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Mini-mapa do trajeto */}
        {data.pontos.length >= 2 && (
          <MapTrajeto
            pontos={data.pontos.map((p) => ({ lat: p.lat, lng: p.lng }))}
            height={280}
            follow
          />
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

      <BuscarLocalModal
        visible={buscaAberta}
        onClose={() => setBuscaAberta(false)}
        onSelecionar={setDestino}
      />
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
