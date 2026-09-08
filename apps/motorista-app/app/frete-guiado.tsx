import { useCallback, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { ArrowLeft, CloudOff, Flag, History, MapPin, Navigation, Search } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScreenHeader } from "@/components/screen-header";
import { MapaViagem } from "@/components/mapa-viagem";
import { BannerManobra } from "@/components/banner-manobra";
import { api } from "@/lib/api";
import { showAlert, showConfirm } from "@/lib/alert";
import { haversineMetros } from "@/lib/geo";
import { anunciar, usePosicaoAoVivo, useGuiaNavegacao } from "@/lib/navegacao";
import type { RotaNav } from "@/lib/queries";
import {
  cancelarTracking,
  estadoPermissaoSempre,
  garantirPermissaoUso,
  iniciarTrackingDetalhado,
  pararTracking,
  pedirPermissaoSempre,
  useViagemAndamento,
} from "@/lib/tracking";
import { clearViagemAndamento, getViagemAndamento } from "@/lib/tracking-storage";
import { hojeISO, lancarViagem } from "@/lib/pessoal";

/** Mesmos cortes da viagem guiada da empresa — chegada é parar perto, não passar perto. */
const CHEGADA_RAIO_M = 90;
const CHEGADA_VEL_MAX = 2.8;
const CHEGADA_PERMANENCIA_MS = 8000;

/** Os últimos destinos dele. Autônomo repete par de cidades — e sem sinal a
 *  busca por texto não existe, então isto é o único caminho que sobra. */
const KEY_RECENTES = "ronan.eu.destinos-recentes";
const MAX_RECENTES = 8;

type Destino = { texto: string; lat: number; lng: number };

async function lerRecentes(): Promise<Destino[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_RECENTES);
    return raw ? (JSON.parse(raw) as Destino[]) : [];
  } catch {
    return [];
  }
}

async function guardarRecente(d: Destino): Promise<void> {
  try {
    const atuais = (await lerRecentes()).filter((r) => r.texto !== d.texto);
    await AsyncStorage.setItem(
      KEY_RECENTES,
      JSON.stringify([d, ...atuais].slice(0, MAX_RECENTES)),
    );
  } catch {
    /* nada aqui pode atrapalhar ele sair */
  }
}

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
  const [semRede, setSemRede] = useState(false);
  const [recentes, setRecentes] = useState<Destino[]>([]);
  const [rota, setRota] = useState<RotaNav | null>(null);
  const [rodando, setRodando] = useState(false);
  /** Carregou o storage? Enquanto não, não dá pra decidir qual tela mostrar. */
  const [pronto, setPronto] = useState(false);
  const [fechando, setFechando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // O GPS só liga quando o frete está rodando. Antes ele ligava no mount: o
  // popup de permissão do sistema aparecia sobre uma tela que só dizia "Pra
  // onde você vai" — permissão pedida antes de o motivo existir, que é
  // exatamente o que a review da Apple marca.
  const pos = usePosicaoAoVivo(rodando);
  const tracking = useViagemAndamento(rodando);

  /**
   * Retoma o frete que já estava rodando.
   *
   * O serviço de GPS é do sistema e sobrevive ao app ser morto — 6h de estrada
   * é o normal. Sem esta leitura, a home dizia "frete em andamento, 214 km" e o
   * toque caía no seletor de destino, sem caminho nenhum pra finalizar.
   */
  useEffect(() => {
    void (async () => {
      const emCurso = await getViagemAndamento();
      if (emCurso) {
        if (emCurso.destino) setDestino(emCurso.destino);
        setRodando(true);
      }
      setRecentes(await lerRecentes());
      setPronto(true);
    })();
  }, []);

  /** Por que não há linha no mapa. `null` = tem rota, ou nem tentou ainda. */
  const [semGuia, setSemGuia] = useState<string | null>(null);

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
      setSemGuia(null);
      return;
    }
    // O mapa abria SEM linha nenhuma e sem uma palavra — o motorista fica
    // olhando pra um mapa mudo sem saber se quebrou, se é o sinal, ou se ele
    // fez algo errado. O km segue sendo medido nos dois casos, e é isso que
    // ele precisa ouvir.
    setSemGuia(
      nova && "erro" in nova
        ? nova.erro
        : "Sem internet pra traçar o caminho agora.",
    );
  }, [destino, pos]);

  // A rota é traçada quando o GPS acha o primeiro ponto — inclusive na volta de
  // um frete retomado, em que a rota se perdeu junto com o processo. O
  // `tentouRota` evita refazer a chamada a cada leitura do GPS (1/s) enquanto
  // ela estiver falhando; quem tenta de novo é o botão do aviso.
  const tentouRota = useRef(false);
  useEffect(() => {
    if (!rodando || !pos || !destino || rota || tentouRota.current) return;
    tentouRota.current = true;
    void recalcular();
  }, [rodando, pos, destino, rota, recalcular]);

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
    setSemRede(false);
    if (timer.current) clearTimeout(timer.current);
    if (texto.trim().length < 3) return setSugestoes([]);
    timer.current = setTimeout(async () => {
      setBuscando(true);
      try {
        setSugestoes(await api.buscarEndereco(texto.trim()));
      } catch {
        // Antes ficava só "procurando…" e depois nada, pra sempre. O app é
        // offline-first e é na estrada que o sinal some: dizer isso, e abrir a
        // saída de rodar sem destino, é o mínimo.
        setSugestoes([]);
        setSemRede(true);
      } finally {
        setBuscando(false);
      }
    }, 450);
  }

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

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

  /** Liga o odômetro. `alvo` nulo = só medir km, sem guia (caminho offline). */
  async function comecar(alvo: Destino | null) {
    // 1) A permissão de USO primeiro — é ela que decide se existe km. O iOS não
    //    dá o "Sempre" pra quem não tem o "Durante o uso", e pedir fora de ordem
    //    faz o sistema mostrar só o primeiro alerta.
    const uso = await garantirPermissaoUso();
    if (uso !== "concedido") {
      const abrir = await showConfirm({
        title: "O app precisa da sua localização",
        message:
          uso === "so-nos-ajustes"
            ? "É com ela que medimos o km do seu frete, e o iPhone já não pergunta mais aqui dentro. Ligue em Ajustes › Movatruck › Localização."
            : "É com ela que medimos o km do seu frete. Sem isso não tem como saber quanto você rodou.",
        confirmLabel: "Abrir os Ajustes",
      });
      if (abrir) await Linking.openSettings().catch(() => {});
      return;
    }

    // 2) O "o tempo todo" é UPGRADE, nunca bloqueio.
    //
    // O iPhone mostra aquele alerta uma vez só. Depois disso o pedido volta na
    // hora, sem desenhar nada — que era o "cliquei em Continuar e não muda
    // nada". Quando é esse o caso, o único caminho é os Ajustes, e insistir com
    // um pop-up nosso é enganação.
    const estado = await estadoPermissaoSempre();
    if (estado === "pode-pedir") {
      const deu = await pedirPermissaoSempre(true);
      if (!deu) {
        void showAlert({
          title: "Vou medir com o app aberto",
          message:
            "Sem o “o tempo todo”, o km conta enquanto o app estiver na tela. Já resolve boa parte do frete — e dá pra ligar depois nos Ajustes.",
        });
      }
    } else if (estado === "so-nos-ajustes") {
      const ir = await showConfirm({
        title: "Pra medir com a tela apagada",
        message:
          "O iPhone só pergunta isso uma vez, e já perguntou. Pra ele contar o km com o celular no bolso, abra os Ajustes e escolha “Sempre” em Movatruck › Localização.\n\nSe preferir, dá pra começar agora do mesmo jeito — aí o km conta enquanto o app estiver na tela.",
        confirmLabel: "Abrir os Ajustes",
        cancelLabel: "Começar assim mesmo",
      });
      // Ele vai sair do app: não faz sentido abrir o frete agora. Quando voltar,
      // toca em começar de novo — e aí já com a permissão certa.
      if (ir) {
        await Linking.openSettings().catch(() => {});
        return;
      }
    }

    // `exigirSempre: false` porque no iPhone a primeira resposta é sempre
    // "Durante o uso do app" — exigir o "Sempre" deixava ele sem medir km
    // NENHUM, quando medir com o app aberto já resolve boa parte do frete.
    const r = await iniciarTrackingDetalhado({
      precisaoAlta: true,
      exigirSempre: false,
      pessoal: true,
      pularPedidoSempre: true,
      ...(alvo ? { destino: alvo } : {}),
    });

    if (r === "ja-tem-frete") return; // ele escolheu voltar pro frete que roda

    if (r !== true) {
      // A permissão já foi negociada acima, então chegar aqui é caso de borda
      // (ele revogou entre um passo e outro). Mesmo assim: nunca parar sem
      // dizer como resolver — beco sem saída foi o problema original.
      const abrir = await showConfirm({
        title: "O app precisa da sua localização",
        message:
          "É com ela que medimos o km do seu frete. Ligue nos Ajustes do iPhone, em Movatruck › Localização.",
        confirmLabel: "Abrir os Ajustes",
      });
      if (abrir) await Linking.openSettings().catch(() => {});
      return;
    }

    if (alvo) {
      setDestino(alvo);
      void guardarRecente(alvo);
    }
    setRodando(true);
    anunciar(alvo ? "Frete iniciado." : "Medindo seu km.");
  }

  /**
   * Fecha o frete: para o GPS e abre a folha de "Cheguei".
   *
   * O que era isto antes: gravava direto `origem: "Início do frete"`, sem valor,
   * e mandava ele "completar no caderno" — um lugar que não existia. Quem só
   * usava o GPS fechava o mês com "Recebi R$ 0,00", e o texto "Início do frete"
   * ainda vazava no link que ele manda pra quem paga.
   */
  const [fecharAberto, setFecharAberto] = useState(false);
  const [kmFinal, setKmFinal] = useState("");
  const [origemFinal, setOrigemFinal] = useState("");
  const [valorFinal, setValorFinal] = useState("");
  const [cargaFinal, setCargaFinal] = useState("");
  const [erroFechar, setErroFechar] = useState<string | null>(null);

  async function abrirFechamento() {
    const resumo = await pararTracking();
    const km = resumo?.kmReal ? Number(resumo.kmReal.toFixed(1)) : null;
    setKmFinal(km ? String(km).replace(".", ",") : "");
    setFecharAberto(true);

    // De onde ele saiu: o primeiro ponto da trilha vira nome de lugar. Melhor
    // que campo vazio, e ele pode corrigir. Sem sinal, fica em branco.
    const primeiro = resumo?.pontos?.[0];
    if (primeiro) {
      const lugar = await api
        .enderecoDaCoordenada(primeiro.lat, primeiro.lng)
        .catch(() => null);
      const nome = [lugar?.bairro, lugar?.cidade, lugar?.uf].filter(Boolean).join(", ");
      if (nome) setOrigemFinal((atual) => atual || nome);
    }
  }

  async function registrar() {
    setErroFechar(null);
    const km = Number(kmFinal.replace(/\./g, "").replace(",", "."));
    if (!km || km <= 0) return setErroFechar("Quantos km você rodou?");
    if (origemFinal.trim().length < 2) return setErroFechar("De onde você saiu?");
    const valor = valorFinal
      ? Number(valorFinal.replace(/\./g, "").replace(",", "."))
      : undefined;

    setFechando(true);
    try {
      await lancarViagem({
        clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        data: hojeISO(),
        origem: origemFinal.trim(),
        destino: destino?.texto ?? busca.trim() ?? "Destino",
        km,
        ...(valor ? { valorRecebido: valor } : {}),
        ...(cargaFinal.trim() ? { carga: cargaFinal.trim() } : {}),
      });
      // Só agora o frete deixa de estar "em andamento". Sem isto, a home dizia
      // "frete rodando" com o km de um frete já registrado — pra sempre.
      await clearViagemAndamento();
      router.replace("/");
    } catch (e) {
      setErroFechar((e as Error).message);
    } finally {
      setFechando(false);
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

  if (!pronto) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  // ---- Fechamento: o que faltava pro frete valer alguma coisa ----
  if (fecharAberto) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
          >
            <ScreenHeader title="Cheguei" subtitle="Confira e registre o frete" semVoltar />

            <View className="flex-1 gap-5 px-5 py-6">
              <View className="gap-2">
                <Label>De onde você saiu</Label>
                <Input
                  value={origemFinal}
                  onChangeText={setOrigemFinal}
                  placeholder="Cidade ou o nome do lugar"
                  editable={!fechando}
                />
              </View>

              <View className="gap-2">
                <Label>Pra onde levou</Label>
                <Input
                  value={destino?.texto ?? busca}
                  editable={false}
                  onChangeText={() => {}}
                />
              </View>

              <View className="gap-2">
                <Label>Km rodados</Label>
                <Input
                  value={kmFinal}
                  onChangeText={(v) => setKmFinal(v.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  editable={!fechando}
                />
                <Text className="text-sm text-muted-foreground">
                  {kmAoVivo > 0
                    ? "Medido pelo GPS. Se o sinal falhou em algum trecho, corrija aqui."
                    : "O GPS não conseguiu medir. Coloque o km do painel do caminhão."}
                </Text>
              </View>

              <View className="gap-2">
                <Label>Quanto você vai receber (opcional)</Label>
                <Input
                  value={valorFinal}
                  onChangeText={(v) => setValorFinal(v.replace(/[^\d.,]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  editable={!fechando}
                />
                <Text className="text-sm text-muted-foreground">
                  É este número que faz o "sobrou" do seu mês bater com o bolso. Dá pra
                  preencher depois, no Histórico.
                </Text>
              </View>

              <View className="gap-2">
                <Label>O que você levou (opcional)</Label>
                <Input
                  value={cargaFinal}
                  onChangeText={setCargaFinal}
                  placeholder="Areia, brita, mudança…"
                  editable={!fechando}
                />
              </View>

              {erroFechar && (
                <View className="rounded-xl border-2 border-destructive bg-destructive/10 p-3">
                  <Text className="text-base font-medium text-destructive">{erroFechar}</Text>
                </View>
              )}

              <Button
                size="lg"
                variant="success"
                className="h-16"
                loading={fechando}
                onPress={() => void registrar()}
              >
                <Flag size={20} color="#fff" />
                <Text className="text-lg font-bold text-success-foreground">
                  {fechando ? "Registrando..." : "Registrar frete"}
                </Text>
              </Button>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ---- Escolha do destino (antes de começar) ----
  if (!rodando) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <ScreenHeader title="Iniciar frete" subtitle="O app te guia até lá e mede seu km" />

          <View className="flex-1 gap-5 px-5 py-6">
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
                  <Search size={16} color="#64748b" />
                  <Text className="text-sm text-muted-foreground">procurando…</Text>
                </View>
              )}
              {sugestoes.map((s) => (
                <Pressable
                  key={s.placeId}
                  onPress={() => void escolher(s)}
                  className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4 active:opacity-70"
                >
                  <MapPin size={18} color="#64748b" />
                  <Text className="flex-1 text-base text-foreground">
                    {s.textoCompleto || s.nome}
                  </Text>
                </Pressable>
              ))}
            </View>

            {semRede && (
              <View className="gap-3 rounded-2xl border-2 border-warning bg-warning/10 p-4">
                <View className="flex-row items-center gap-2">
                  <CloudOff size={18} color="#b45309" />
                  <Text className="flex-1 text-base font-bold text-foreground">
                    Sem internet pra buscar o endereço
                  </Text>
                </View>
                <Text className="text-sm text-muted-foreground">
                  Dá pra rodar assim mesmo: o app mede seu km sem precisar de sinal. O guia de
                  voz é que não vai ter.
                </Text>
                <Button size="lg" onPress={() => void comecar(null)}>
                  <Navigation size={20} color="#fff" />
                  <Text className="text-base font-bold text-primary-foreground">
                    Só medir meu km
                  </Text>
                </Button>
              </View>
            )}

            {!destino && sugestoes.length === 0 && recentes.length > 0 && (
              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <History size={16} color="#64748b" />
                  <Text className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                    Onde você já foi
                  </Text>
                </View>
                {recentes.map((r) => (
                  <Pressable
                    key={r.texto}
                    onPress={() => {
                      setDestino(r);
                      setBusca(r.texto);
                    }}
                    className="flex-row items-center gap-3 rounded-xl border border-border bg-card p-4 active:opacity-70"
                  >
                    <MapPin size={18} color="#64748b" />
                    <Text className="flex-1 text-base text-foreground">{r.texto}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {destino && (
              <Card className="flex-row items-center gap-3 border-primary p-4">
                <Flag size={22} color="#13316b" />
                <Text className="flex-1 text-base font-bold text-foreground">{destino.texto}</Text>
              </Card>
            )}

            <Button
              size="lg"
              className="h-16"
              disabled={!destino}
              onPress={() => void comecar(destino)}
            >
              <Navigation size={22} color="#fff" />
              <Text className="text-lg font-bold text-primary-foreground">Começar e me guiar</Text>
            </Button>

            <Text className="text-center text-sm text-muted-foreground">
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

      {/* O topo tem que respeitar a Dynamic Island: o banner de manobra passava
          por baixo dela, e com o guia ainda nulo sobrava mapa claro sob os
          ícones brancos do sistema. */}
      <SafeAreaView
        edges={["top"]}
        pointerEvents="box-none"
        className="absolute inset-x-0 top-0"
      >
        <View className="flex-row items-start gap-2 px-3 pt-2" pointerEvents="box-none">
          <Pressable
            onPress={() => router.back()}
            className="h-11 w-11 items-center justify-center rounded-full bg-background/95 shadow-md active:opacity-80"
          >
            <ArrowLeft size={22} color="#0f172a" />
          </Pressable>
          <View className="flex-1" pointerEvents="box-none">
            {guia ? (
              <BannerManobra
                manobra={guia.manobra}
                distProxM={guia.distProxM}
                restanteM={guia.restanteM}
                foraDaRota={guia.foraDaRota}
              />
            ) : (
              semGuia && (
                <View className="gap-2 rounded-2xl border-2 border-warning bg-card p-4 shadow-md">
                  <Text className="text-base font-bold text-foreground">
                    Sem o caminho desenhado
                  </Text>
                  <Text className="text-sm text-muted-foreground">
                    {semGuia} O seu km continua sendo medido normalmente — é ele que vai pro
                    frete.
                  </Text>
                  <Pressable
                    onPress={() => {
                      tentouRota.current = true;
                      void recalcular();
                    }}
                    className="self-start rounded-xl bg-secondary px-4 py-3 active:opacity-70"
                  >
                    <Text className="text-base font-bold text-primary">Tentar de novo</Text>
                  </Pressable>
                </View>
              )
            )}
          </View>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} className="absolute bottom-0 left-0 right-0">
        <Card className="m-4 gap-3 p-4">
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
              <View className="rounded-full bg-success/15 px-3 py-2">
                <Text className="text-sm font-bold text-success">Você chegou</Text>
              </View>
            )}
          </View>

          <Button
            size="lg"
            className="h-16"
            variant={chegou ? "success" : "default"}
            onPress={() => void abrirFechamento()}
          >
            <Flag size={20} color="#fff" />
            <Text className="text-lg font-bold text-white">Cheguei — registrar frete</Text>
          </Button>

          {/* Cancelar DESCARTA o km medido: ação destrutiva não pode ser um
              texto cinza de 26px de altura. */}
          <Button size="lg" variant="outline" onPress={() => void desistir()}>
            <Text className="text-base font-semibold text-foreground">Cancelar frete</Text>
          </Button>
        </Card>
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
