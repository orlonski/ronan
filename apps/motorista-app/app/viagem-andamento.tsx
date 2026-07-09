import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  AlertTriangle,
  ChevronLeft,
  Flag,
  Navigation,
  Save,
  Square,
  Trash2,
} from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MapaViagem } from "@/components/mapa-viagem";
import { BannerManobra } from "@/components/banner-manobra";
import { BuscarLocalModal } from "@/components/buscar-local-modal";
import { Button } from "@/components/ui/button";
import { showAlert, showConfirm } from "@/lib/alert";
import { haversineMetros, pegarCoords } from "@/lib/geo";
import { buscarNavegacao, type Local, type RotaNav } from "@/lib/queries";
import { anunciar, usePosicaoAoVivo, useGuiaNavegacao } from "@/lib/navegacao";
import {
  clearNavDestino,
  getNavDestino,
  setNavDestino,
} from "@/lib/nav-destino-storage";
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

  // Navegação até a descarga. Todos que chegam nesta tela têm "Iniciar viagem
  // com GPS" (o botão da Home exige a permissão), então o guia é sempre disponível.
  const [destino, setDestino] = useState<Local | null>(null);
  const [navRota, setNavRota] = useState<RotaNav | null | undefined>(null);
  const [buscaAberta, setBuscaAberta] = useState(false);

  // Posição ao vivo (câmera + motor do guia). Ativa enquanto a tela está aberta.
  const pos = usePosicaoAoVivo(true);

  const viagemId = data?.id ?? null;

  // Salva o destino escolhido amarrado à viagem atual (sobrevive sair/voltar e
  // fechar/reabrir o app). Best-effort — se falhar, navegação segue em memória.
  const persistir = useCallback(
    (local: Local, rota: RotaNav | null) => {
      if (!viagemId) return;
      void setNavDestino({ viagemId, destino: local, rota });
    },
    [viagemId],
  );

  async function escolherDestino(local: Local) {
    setDestino(local);
    if (local.lat == null || local.lng == null) {
      setNavRota(null);
      persistir(local, null);
      return;
    }
    setNavRota(undefined);
    const c = await pegarCoords().catch(() => null);
    if (!c) {
      setNavRota(null);
      persistir(local, null);
      return;
    }
    const r = await buscarNavegacao(c.lat, c.lng, local.id);
    setNavRota(r);
    persistir(local, r);
  }

  // Restaura o destino salvo ao abrir a tela (só se for a MESMA viagem). Roda 1x
  // por viagem; se o salvo for de outra viagem, limpa.
  const [restaurou, setRestaurou] = useState(false);
  useEffect(() => {
    if (restaurou || !viagemId) return;
    setRestaurou(true);
    void getNavDestino().then((salvo) => {
      if (!salvo) return;
      if (salvo.viagemId === viagemId) {
        setDestino(salvo.destino);
        setNavRota(salvo.rota);
      } else {
        void clearNavDestino();
      }
    });
  }, [viagemId, restaurou]);

  function trocarDestino() {
    setDestino(null);
    setNavRota(null);
    void clearNavDestino();
  }

  // Recálculo ao sair da rota: busca rota nova da posição atual. Só TROCA se veio
  // uma (online) e aí fala "Recalculando"; offline `buscarNavegacao` devolve null
  // e a gente MANTÉM a rota atual (o guia já avisou por voz que saiu).
  const recalcular = useCallback(async () => {
    if (!destino || destino.lat == null || destino.lng == null) return;
    const c = await pegarCoords().catch(() => null);
    if (!c) return;
    const nova = await buscarNavegacao(c.lat, c.lng, destino.id);
    if (nova) {
      anunciar("Recalculando.");
      setNavRota(nova);
      persistir(destino, nova);
    }
  }, [destino, persistir]);

  const guia = useGuiaNavegacao(navRota ?? null, pos, recalcular);

  // "Só rastrear" — motorista optou por não escolher destino (não tem local
  // cadastrado, etc). Libera finalizar sem passar pelo guia.
  const [semDestino, setSemDestino] = useState(false);

  // CHEGOU: posição ao vivo dentro de ~160m do destino escolhido (arrival
  // detection estilo Waze). É local — funciona offline (GPS + rota já baixada).
  const CHEGADA_RAIO_M = 160;
  const chegou = useMemo(() => {
    if (!destino || destino.lat == null || destino.lng == null || !pos) return false;
    return haversineMetros(pos.lat, pos.lng, destino.lat, destino.lng) <= CHEGADA_RAIO_M;
  }, [destino, pos]);

  // Avisa 1x ao chegar (voz + vibração). Rearma se sair do raio (recalibrou).
  const chegouAvisadoRef = useRef(false);
  useEffect(() => {
    if (chegou && !chegouAvisadoRef.current) {
      chegouAvisadoRef.current = true;
      anunciar("Você chegou ao destino.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (!chegou) {
      chegouAvisadoRef.current = false;
    }
  }, [chegou]);

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
      void clearNavDestino();
      router.replace({
        pathname: "/nova-viagem",
        params: {
          fromTracking: "1",
          // O destino que ele navegou É a descarga — leva junto pra não perguntar
          // de novo no formulário.
          ...(destino ? { descargaId: destino.id } : {}),
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
    void clearNavDestino();
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

  const navegando = !!navRota;
  const destinoCoords =
    destino && destino.lat != null && destino.lng != null
      ? { lat: destino.lat, lng: destino.lng, nome: destino.nome }
      : undefined;
  const trilha = data.pontos.map((p) => ({ lat: p.lat, lng: p.lng }));

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* MAPA HERO — ocupa a tela toda; overlays ficam por cima */}
      <View className="absolute inset-0">
        <MapaViagem
          trilha={trilha}
          // Órfão (captura parada): não persegue a posição — enquadra o trajeto
          // capturado, deixando claro que a viagem já acabou (falta só lançar).
          shape={taskAtiva === false ? undefined : navRota?.shape}
          destino={taskAtiva === false ? undefined : destinoCoords}
          pos={taskAtiva === false ? null : pos}
        />
      </View>

      {/* TOPO: voltar + título, banner de manobra e avisos (flutuando) */}
      <SafeAreaView
        edges={["top"]}
        pointerEvents="box-none"
        className="absolute inset-x-0 top-0"
      >
        <View className="gap-2 p-3" pointerEvents="box-none">
          <View className="flex-row items-center gap-2" pointerEvents="box-none">
            <Pressable
              onPress={() => router.back()}
              className="h-11 w-11 items-center justify-center rounded-full bg-background/95 shadow-md"
            >
              <ChevronLeft size={24} color="#0f172a" />
            </Pressable>
            <View className="rounded-full bg-background/95 px-4 py-2 shadow-md">
              <Text className="text-sm font-bold text-foreground">
                Viagem em andamento
              </Text>
            </View>
          </View>

          {navegando && navRota && (
            <BannerManobra
              manobra={guia.manobra}
              distProxM={guia.distProxM}
              restanteM={guia.restanteM}
              foraDaRota={guia.foraDaRota}
            />
          )}

          {taskAtiva && horasSemPonto(data) >= 6 && (
            <AvisoChip
              texto={`Sem GPS há ${horasSemPonto(data).toFixed(0)}h — provavelmente esqueceu de finalizar.`}
            />
          )}
        </View>
      </SafeAreaView>

      {/* BARRA INFERIOR — números + destino/ETA + ações */}
      <SafeAreaView
        edges={["bottom"]}
        pointerEvents="box-none"
        className="absolute inset-x-0 bottom-0"
      >
        <View className="gap-3 rounded-t-3xl border-t-2 border-border bg-background px-4 pb-2 pt-4 shadow-2xl">
          {/* Números da viagem */}
          <View className="flex-row justify-between">
            <StatBig
              label={taskAtiva === false ? "capturado" : "distância"}
              value={`${resumo?.kmReal.toFixed(1).replace(".", ",") ?? "0,0"} km`}
            />
            <StatBig label="tempo" value={fmtDuracao(resumo?.duracaoMin ?? 0)} />
            <StatBig
              label="vel. média"
              value={`${(resumo?.velocidadeMediaKmh ?? 0).toFixed(0)} km/h`}
            />
          </View>

          {/* Máquina de estados da viagem (estilo Waze) */}
          {taskAtiva === false ? (
            /* ÓRFÃO: a captura foi encerrada (você finalizou e voltou, ou o
               sistema parou) e a viagem AINDA NÃO FOI LANÇADA. Deixa cristalino
               o que é o "salvar" e que nada foi perdido. */
            <>
              <View className="gap-1 rounded-2xl border-2 border-primary/40 bg-primary/10 p-3">
                <Text className="text-base font-extrabold text-foreground">
                  Viagem capturada — falta lançar
                </Text>
                <Text
                  className="text-xs text-muted-foreground"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  A captura terminou e você tem{" "}
                  {resumo?.kmReal.toFixed(1).replace(".", ",") ?? "0,0"} km salvos
                  no aparelho. Toque abaixo pra preencher cliente, peso e ticket e
                  lançar — nada foi perdido.
                </Text>
              </View>
              <Button
                variant="default"
                size="lg"
                className="h-16"
                onPress={finalizar}
                loading={parando}
                disabled={parando}
              >
                <Save size={20} color="white" />
                <Text className="text-lg font-bold text-primary-foreground">
                  Lançar viagem
                </Text>
              </Button>
            </>
          ) : chegou ? (
            /* CHEGOU (~160m do destino): destaque de chegada + finalizar. */
            <>
              <View className="flex-row items-center gap-3 rounded-2xl border-2 border-success/40 bg-success/15 p-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-success">
                  <Flag size={20} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-extrabold text-foreground" numberOfLines={1}>
                    Você chegou{destino ? ` em ${destino.nome}` : ""}!
                  </Text>
                  <Text
                    className="text-xs text-muted-foreground"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {resumo?.kmReal.toFixed(1).replace(".", ",") ?? "0,0"} km ·{" "}
                    {fmtDuracao(resumo?.duracaoMin ?? 0)} — confira e finalize
                  </Text>
                </View>
              </View>
              <Button
                variant="default"
                size="lg"
                className="h-16"
                onPress={finalizar}
                loading={parando}
                disabled={parando}
              >
                <Square size={20} color="white" />
                <Text className="text-lg font-bold text-primary-foreground">
                  Finalizar viagem
                </Text>
              </Button>
            </>
          ) : destino ? (
            /* NAVEGANDO: destino + ETA; finalizar fica SECUNDÁRIO (fim antecipado). */
            <>
              <View className="flex-row items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                <View className="flex-1">
                  <Text className="text-sm font-bold text-foreground" numberOfLines={1}>
                    → {destino.nome}
                  </Text>
                  {navRota === undefined ? (
                    <Text className="text-xs text-muted-foreground">
                      montando o guia…
                    </Text>
                  ) : navRota ? (
                    <Text
                      className="text-xs text-muted-foreground"
                      style={{ fontVariant: ["tabular-nums"] }}
                    >
                      faltam {navRota.distanciaKm.toFixed(1).replace(".", ",")} km
                      {" · "}~{Math.max(1, Math.round(navRota.tempoSeg / 60))} min
                    </Text>
                  ) : (
                    <Text className="text-xs text-muted-foreground">
                      sem rota — tente com sinal ou troque o destino
                    </Text>
                  )}
                </View>
                <Pressable onPress={trocarDestino} className="px-2 py-1">
                  <Text className="text-xs font-semibold text-muted-foreground">
                    Trocar
                  </Text>
                </Pressable>
              </View>
              <Button
                variant="outline"
                onPress={finalizar}
                loading={parando}
                disabled={parando}
              >
                <Square size={18} color="#0f172a" />
                <Text className="text-sm font-semibold text-foreground">
                  Cheguei — finalizar agora
                </Text>
              </Button>
            </>
          ) : semDestino ? (
            /* SÓ RASTREAR (sem destino escolhido): finalizar direto. */
            <>
              <Button
                variant="outline"
                onPress={() => {
                  setSemDestino(false);
                  setBuscaAberta(true);
                }}
              >
                <Navigation size={18} color="#2563eb" />
                <Text className="text-sm font-semibold text-foreground">
                  Escolher destino (ligar o guia)
                </Text>
              </Button>
              <Button
                variant="default"
                size="lg"
                onPress={finalizar}
                loading={parando}
                disabled={parando}
              >
                <Square size={20} color="white" />
                <Text className="text-base font-bold text-primary-foreground">
                  Finalizar viagem
                </Text>
              </Button>
            </>
          ) : (
            /* RECÉM-INICIADA (sem destino): 1 ação só — pra onde vai. Sem finalizar. */
            <>
              <Button
                size="lg"
                className="h-16"
                onPress={() => setBuscaAberta(true)}
              >
                <Navigation size={22} color="white" />
                <Text className="text-lg font-bold text-primary-foreground">
                  Para onde você vai?
                </Text>
              </Button>
              <Pressable onPress={() => setSemDestino(true)} className="py-1">
                <Text className="text-center text-xs font-medium text-muted-foreground">
                  Só rastrear o km (sem destino)
                </Text>
              </Pressable>
            </>
          )}

          <Button variant="ghost" onPress={confirmarCancelar} disabled={parando}>
            <Trash2 size={16} color="#dc2626" />
            <Text className="text-sm font-medium text-destructive">
              Descartar viagem
            </Text>
          </Button>
        </View>
      </SafeAreaView>

      <BuscarLocalModal
        visible={buscaAberta}
        onClose={() => setBuscaAberta(false)}
        onSelecionar={escolherDestino}
      />
    </View>
  );
}

function StatBig({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text
        className="text-xl font-extrabold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
      <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </Text>
    </View>
  );
}

function AvisoChip({ texto }: { texto: string }) {
  return (
    <View className="flex-row items-center gap-2 rounded-xl border border-warning/40 bg-warning/15 px-3 py-2 shadow">
      <AlertTriangle size={16} color="#b45309" />
      <Text className="flex-1 text-xs font-medium text-warning-foreground">
        {texto}
      </Text>
    </View>
  );
}

function horasSemPonto(data: {
  pontos: { capturadoEm: string }[];
  iniciadoEm: string;
}): number {
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
  return `${h}h${m.toString().padStart(2, "0")}`;
}
