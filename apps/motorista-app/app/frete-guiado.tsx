import { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { ArrowLeft, Flag, MapPin, Navigation, Search } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapaViagem } from "@/components/mapa-viagem";
import { BannerManobra } from "@/components/banner-manobra";
import { api } from "@/lib/api";
import { showAlert, showConfirm } from "@/lib/alert";
import { haversineMetros } from "@/lib/geo";
import { anunciar, usePosicaoAoVivo, useGuiaNavegacao } from "@/lib/navegacao";
import type { RotaNav } from "@/lib/queries";
import {
  cancelarTracking,
  iniciarTracking,
  pararTracking,
  useViagemAndamento,
} from "@/lib/tracking";
import { hojeISO, lancarViagem } from "@/lib/pessoal";

/** Mesmos cortes da viagem guiada da empresa — chegada é parar perto, não passar perto. */
const CHEGADA_RAIO_M = 90;
const CHEGADA_VEL_MAX = 2.8;
const CHEGADA_PERMANENCIA_MS = 8000;

type Destino = { texto: string; lat: number; lng: number };

/**
 * O frete guiado do motorista por conta própria: o app leva ele até o destino e
 * mede o km rodado.
 *
 * É a MESMA experiência da viagem guiada da empresa — mesmo mapa, mesmo guia de
 * voz, mesma detecção de chegada —, com duas diferenças que vêm de não haver
 * empresa: o destino é um ponto do mapa (geocoding) em vez de um `Local` do
 * catálogo, e o km medido vira o frete DELE em vez de uma viagem da
 * transportadora.
 *
 * O rastreamento em segundo plano aqui é o odômetro dele: quem inicia é ele,
 * quem para é ele, e o número que sai é dele. Ver docs/motorista-sem-empresa.md.
 */
export default function FreteGuiadoScreen() {
  const [destino, setDestino] = useState<Destino | null>(null);
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<
    { placeId: string; nome: string; textoCompleto: string }[]
  >([]);
  const [buscando, setBuscando] = useState(false);
  const [rota, setRota] = useState<RotaNav | null>(null);
  const [rodando, setRodando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pos = usePosicaoAoVivo(true);
  const tracking = useViagemAndamento(rodando);

  const recalcular = useCallback(async () => {
    if (!destino || !pos) return;
    const nova = await api
      .navegarPessoal({
        origemLat: pos.lat,
        origemLng: pos.lng,
        destinoLat: destino.lat,
        destinoLng: destino.lng,
      })
      .catch(() => null);
    // Offline devolve nada: mantém a rota atual em vez de apagar o guia — ele
    // continua vendo a linha e ouvindo o que já foi baixado.
    if (nova && !("erro" in nova)) {
      anunciar("Recalculando.");
      setRota(nova);
    }
  }, [destino, pos]);

  const guia = useGuiaNavegacao(rodando ? rota : null, pos, recalcular);

  // Chegou: perto E parando (ou perto por um tempo). Passar na frente não conta.
  const [chegou, setChegou] = useState(false);
  const pertoDesde = useRef<number | null>(null);
  useEffect(() => {
    if (!rodando || !destino || !pos) {
      pertoDesde.current = null;
      setChegou(false);
      return;
    }
    const d = haversineMetros(pos.lat, pos.lng, destino.lat, destino.lng);
    if (d > CHEGADA_RAIO_M) {
      pertoDesde.current = null;
      setChegou(false);
      return;
    }
    if (pertoDesde.current == null) pertoDesde.current = Date.now();
    const lento = pos.speed != null && pos.speed >= 0 && pos.speed < CHEGADA_VEL_MAX;
    setChegou(lento || Date.now() - pertoDesde.current > CHEGADA_PERMANENCIA_MS);
  }, [rodando, destino, pos]);

  const avisou = useRef(false);
  useEffect(() => {
    if (chegou && !avisou.current) {
      avisou.current = true;
      anunciar("Você chegou ao destino.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (!chegou) {
      avisou.current = false;
    }
  }, [chegou]);

  function digitou(texto: string) {
    setBusca(texto);
    if (timer.current) clearTimeout(timer.current);
    if (texto.trim().length < 3) return setSugestoes([]);
    timer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        setSugestoes(await api.buscarEndereco(texto.trim()));
      } catch {
        setSugestoes([]);
      } finally {
        setBuscando(false);
      }
    }, 450);
  }

  async function escolher(s: { placeId: string; nome: string; textoCompleto: string }) {
    setSugestoes([]);
    setBusca(s.textoCompleto || s.nome);
    const lugar = await api.resolverEndereco(s.placeId).catch(() => null);
    if (lugar?.lat == null || lugar?.lng == null) {
      void showAlert({
        title: "Não achei esse lugar no mapa",
        message: "Tente pelo nome da cidade, ou escolha outro ponto da lista.",
      });
      return;
    }
    setDestino({ texto: s.textoCompleto || s.nome, lat: lugar.lat, lng: lugar.lng });
  }

  async function comecar() {
    if (!destino) return;
    // O rastreamento é o odômetro: sem ele não há km medido, e o frete voltaria
    // a ser digitado à mão. Se ele recusar a permissão, seguimos só com o guia.
    const ok = await iniciarTracking({ precisaoAlta: true });
    if (!ok) {
      const seguir = await showConfirm({
        title: "Sem a localização o app não mede o km",
        message: "Dá pra seguir só com o guia na tela, e você informa o km no fim.",
        confirmLabel: "Seguir assim",
      });
      if (!seguir) return;
    }
    if (pos) {
      const r = await api
        .navegarPessoal({
          origemLat: pos.lat,
          origemLng: pos.lng,
          destinoLat: destino.lat,
          destinoLng: destino.lng,
        })
        .catch(() => null);
      if (r && !("erro" in r)) setRota(r);
    }
    setRodando(true);
    anunciar("Frete iniciado.");
  }

  async function finalizar() {
    setFinalizando(true);
    try {
      const resumo = await pararTracking();
      const km = resumo?.kmReal ? Number(resumo.kmReal.toFixed(1)) : undefined;
      await lancarViagem({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        data: hojeISO(),
        origem: "Início do frete",
        destino: destino?.texto ?? "Destino",
        km,
      });
      void showAlert({
        title: "Frete registrado",
        message: km
          ? `${km.toLocaleString("pt-BR")} km medidos pelo GPS. Complete o que recebeu no seu caderno.`
          : "Complete o km e o valor no seu caderno.",
      });
      router.replace("/meus-gastos");
    } catch (e) {
      void showAlert({ title: "Não deu pra registrar", message: (e as Error).message });
    } finally {
      setFinalizando(false);
    }
  }

  async function desistir() {
    const ok = await showConfirm({
      title: "Cancelar este frete?",
      message: "O que o GPS mediu até agora é descartado.",
      confirmLabel: "Cancelar frete",
      destructive: true,
    });
    if (!ok) return;
    await cancelarTracking();
    router.back();
  }

  const kmAoVivo = tracking.resumo?.kmReal ?? 0;

  // ---- Escolha do destino (antes de começar) ----
  if (!rodando) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="bg-brand px-6 pb-6 pt-14">
            <View className="flex-row items-center gap-3">
              <Pressable onPress={() => router.back()} hitSlop={12}>
                <ArrowLeft size={24} color="#fff" />
              </Pressable>
              <View className="flex-1">
                <Text className="text-2xl font-extrabold tracking-tight text-white">
                  Iniciar frete
                </Text>
                <Text className="text-sm font-medium text-white/80">
                  O app te guia até lá e mede seu km
                </Text>
              </View>
            </View>
          </View>

          <View className="flex-1 gap-5 px-6 py-6">
            <View className="gap-2">
              <Label>Pra onde você vai</Label>
              <Input
                value={busca}
                onChangeText={digitou}
                placeholder="Cidade, obra, pedreira…"
                autoCorrect={false}
              />
              {buscando && (
                <View className="flex-row items-center gap-2">
                  <Search size={14} color="#64748b" />
                  <Text className="text-xs text-muted-foreground">procurando…</Text>
                </View>
              )}
              {sugestoes.map((s) => (
                <Pressable
                  key={s.placeId}
                  onPress={() => void escolher(s)}
                  className="flex-row items-center gap-2 rounded-xl border border-border bg-card p-3 active:opacity-70"
                >
                  <MapPin size={16} color="#64748b" />
                  <Text className="flex-1 text-base text-foreground">
                    {s.textoCompleto || s.nome}
                  </Text>
                </Pressable>
              ))}
            </View>

            {destino && (
              <View className="flex-row items-center gap-3 rounded-2xl border-2 border-primary bg-card p-4">
                <Flag size={22} color="#13316b" />
                <Text className="flex-1 text-base font-bold text-foreground">{destino.texto}</Text>
              </View>
            )}

            <Button
              size="lg"
              className="h-16"
              disabled={!destino}
              onPress={() => void comecar()}
            >
              <Navigation size={22} color="#fff" />
              <Text className="text-lg font-bold text-primary-foreground">
                Começar e me guiar
              </Text>
            </Button>

            <Text className="text-center text-xs text-muted-foreground">
              O app segue medindo com a tela bloqueada — é assim que o km sai certo. Você para
              quando quiser, aqui mesmo.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Em movimento ----
  return (
    <View className="flex-1 bg-background">
      <MapaViagem
        trilha={tracking.data?.pontos ?? []}
        shape={rota?.shape ?? undefined}
        destino={destino ? { lat: destino.lat, lng: destino.lng } : undefined}
        pos={pos}
      />

      {guia && (
        <BannerManobra
          manobra={guia.manobra}
          distProxM={guia.distProxM}
          restanteM={guia.restanteM}
          foraDaRota={guia.foraDaRota}
        />
      )}

      <SafeAreaView edges={["bottom"]} className="absolute bottom-0 left-0 right-0">
        <View className="m-4 gap-3 rounded-2xl border-2 border-border bg-card p-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Rodou até agora
              </Text>
              <Text
                className="text-3xl font-extrabold text-foreground"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {kmAoVivo.toFixed(1)} km
              </Text>
            </View>
            {chegou && (
              <View className="rounded-full bg-green-100 px-3 py-1.5">
                <Text className="text-sm font-bold text-green-800">Você chegou</Text>
              </View>
            )}
          </View>

          <Button
            size="lg"
            className={chegou ? "h-16 bg-green-600" : "h-16"}
            loading={finalizando}
            onPress={() => void finalizar()}
          >
            <Flag size={20} color="#fff" />
            <Text className="text-lg font-bold text-white">
              {finalizando ? "Registrando..." : "Cheguei — registrar frete"}
            </Text>
          </Button>

          <Pressable onPress={() => void desistir()} className="py-1">
            <Text className="text-center text-base font-medium text-muted-foreground">
              Cancelar frete
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {!pos && (
        <View className="absolute left-0 right-0 top-1/2 items-center">
          <View className="flex-row items-center gap-2 rounded-full bg-card px-4 py-2">
            <ActivityIndicator />
            <Text className="text-base text-foreground">Procurando o sinal do GPS…</Text>
          </View>
        </View>
      )}
    </View>
  );
}
