import { useEffect, useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { Flag } from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { DescargaPorGps, type DescargaCaptura } from "@/components/descarga-por-gps";
import { SeletorRotas } from "@/components/seletor-rotas";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { SemCatalogo } from "@/components/sem-catalogo";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { AvisoKmEstimado } from "@/components/aviso-km-estimado";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { hojeISO } from "@/lib/datetime";
import {
  finalizarViagemGuiada,
  getLifecycleLocal,
  salvarFinalizarDraft,
  type LifecycleLocal,
} from "@/lib/lifecycle";
import { useCalcularRota, useCatalogos, useRotasAlternativas } from "@/lib/queries";

/**
 * Passo final do lifecycle guiado: coleta os dados que faltam pra fechar a
 * viagem (cliente, material, toneladas, km, pedágio, observação, foto) e o
 * local de descarga por GPS. Enfileira o /finalizar e limpa o espelho local.
 */
export default function FinalizarViagem() {
  const cat = useCatalogos();
  const [ciclo, setCiclo] = useState<LifecycleLocal | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [clienteId, setClienteId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [toneladas, setToneladas] = useState("");
  const [ticket, setTicket] = useState("");
  const [km, setKm] = useState("");
  const [kmEditadoManual, setKmEditadoManual] = useState(false);
  // Rota escolhida no seletor de mapa (quando há alternativas).
  const [rotaIdx, setRotaIdx] = useState(0);
  const [rotaGeometriaEscolhida, setRotaGeometriaEscolhida] = useState<string | null>(null);
  const [localDescargaId, setLocalDescargaId] = useState("");
  const [descargaCaptura, setDescargaCaptura] = useState<DescargaCaptura | null>(null);
  const [descargaNomeDraft, setDescargaNomeDraft] = useState<string | undefined>(undefined);
  const [valorPedagio, setValorPedagio] = useState("");
  const [observacao, setObservacao] = useState("");
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const val = useValidacaoGuiada();
  // Só começa a salvar o rascunho depois de hidratar (não sobrescrever com vazio).
  const [hidratado, setHidratado] = useState(false);

  useEffect(() => {
    let alive = true;
    void getLifecycleLocal().then((atual) => {
      if (!alive) return;
      if (!atual) {
        router.replace("/");
        return;
      }
      setCiclo(atual);
      setClienteId(atual.clienteId); // cliente já escolhido no iniciar
      // Restaura o rascunho (descarga + campos) se já tinha começado a finalizar.
      const d = atual.finalizarDraft;
      if (d) {
        if (d.localDescargaId) setLocalDescargaId(d.localDescargaId);
        if (d.descargaCaptura) setDescargaCaptura(d.descargaCaptura);
        if (d.descargaNome) setDescargaNomeDraft(d.descargaNome);
        if (d.materialId) setMaterialId(d.materialId);
        if (d.toneladas != null) setToneladas(d.toneladas);
        if (d.ticket != null) setTicket(d.ticket);
        if (d.km != null) setKm(d.km);
        if (d.kmEditadoManual) setKmEditadoManual(true);
        if (d.rotaGeometria != null) setRotaGeometriaEscolhida(d.rotaGeometria);
        if (d.rotaIdx != null) setRotaIdx(d.rotaIdx);
        if (d.valorPedagio != null) setValorPedagio(d.valorPedagio);
        if (d.observacao != null) setObservacao(d.observacao);
        if (d.fotoUri && d.fotoMime) setFoto({ uri: d.fotoUri, mime: d.fotoMime });
      }
      setHidratado(true);
      setCarregando(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const materialOptions: SelectOption[] = useMemo(
    () => (cat.data?.materiais ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [cat.data?.materiais],
  );

  // Material que não exige ticket (ex: concreto) esconde o campo. Default true.
  const exigeTicket = useMemo(() => {
    const m = cat.data?.materiais.find((x) => x.id === materialId);
    return m?.exigeTicket ?? true;
  }, [cat.data?.materiais, materialId]);

  // KM auto via OSRM entre local de carga (se cadastrado) e descarga.
  const localCargaId = ciclo?.localCargaId ?? "";
  const rota = useCalcularRota(localCargaId, localDescargaId);
  // Rotas alternativas pro seletor de mapa (online-only; [] offline). Mostra o
  // mapa sempre que houver ao menos 1 rota (informativo); vira seletor com 2+.
  const alternativas = useRotasAlternativas(localCargaId, localDescargaId);
  const temMapa = (alternativas.data?.length ?? 0) >= 1;
  // km da rota recomendada (routes[0]) — snapshot pra kmCalculado.
  const kmRecomendado = useMemo(() => {
    const rec = alternativas.data?.find((r) => r.recomendada);
    if (rec) return parseFloat(rec.km);
    // Só km de rota REAL (OSRM/cache) conta como "calculado". O estimado por
    // haversine (sem rede) NÃO vai como kmCalculado — sinaliza pro backend
    // recalcular pelo trajeto certo quando sincronizar.
    return rota.data &&
      "km" in rota.data &&
      rota.data.km !== null &&
      rota.data.fonte !== "estimado_haversine"
      ? parseFloat(String(rota.data.km))
      : undefined;
  }, [alternativas.data, rota.data]);

  // Escolher uma rota no seletor: seta km + guarda a geometria (rota real no
  // painel) + o km da recomendada como kmCalculado. NÃO marca edição manual.
  function escolherRota(idx: number) {
    const r = alternativas.data?.[idx];
    if (!r) return;
    setRotaIdx(idx);
    setRotaGeometriaEscolhida(r.geometria);
    setKm(r.km);
  }

  // Enquanto o seletor governa o km (rota escolhida), o auto-fill fica parado.
  const kmGovernadoPorRota = temMapa && rotaGeometriaEscolhida != null;
  useEffect(() => {
    if (kmEditadoManual || kmGovernadoPorRota) return;
    if (!rota.data || rota.data.km === null) return;
    setKm((cur) => (cur === rota.data!.km ? cur : (rota.data as { km: string }).km));
  }, [rota.data, kmEditadoManual, kmGovernadoPorRota]);

  // Ao carregar as alternativas (1+), pré-seleciona a recomendada (guarda a
  // geometria pro painel) — a menos que o motorista já tenha escolhido/editado.
  useEffect(() => {
    if (kmEditadoManual || rotaGeometriaEscolhida != null) return;
    const alts = alternativas.data;
    if (!alts || alts.length < 1) return;
    const recIdx = Math.max(0, alts.findIndex((r) => r.recomendada));
    escolherRota(recIdx);
  }, [alternativas.data, kmEditadoManual, rotaGeometriaEscolhida]); // eslint-disable-line react-hooks/exhaustive-deps

  const nomeDescargaSelecionado = useMemo(() => {
    if (!localDescargaId) return undefined;
    // Catálogo primeiro; fallback pro nome do rascunho (local novo offline
    // pode não estar no catálogo após reabrir o app).
    return cat.data?.locais.find((l) => l.id === localDescargaId)?.nome ?? descargaNomeDraft;
  }, [localDescargaId, cat.data?.locais, descargaNomeDraft]);

  const localCargaCoords = useMemo(() => {
    if (!localCargaId) return null;
    const l = cat.data?.locais.find((x) => x.id === localCargaId);
    if (!l || l.lat == null || l.lng == null) return null;
    return { lat: l.lat, lng: l.lng, nome: l.nome };
  }, [localCargaId, cat.data?.locais]);

  // Salva o rascunho (debounced) sempre que algo muda — sobrevive a voltar/sair.
  useEffect(() => {
    if (!hidratado) return;
    const t = setTimeout(() => {
      void salvarFinalizarDraft({
        localDescargaId: localDescargaId || undefined,
        descargaNome: nomeDescargaSelecionado,
        descargaCaptura,
        materialId: materialId || undefined,
        toneladas,
        ticket,
        km,
        kmEditadoManual,
        rotaGeometria: rotaGeometriaEscolhida ?? undefined,
        rotaIdx,
        valorPedagio,
        observacao,
        fotoUri: foto?.uri,
        fotoMime: foto?.mime,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [
    hidratado,
    localDescargaId,
    nomeDescargaSelecionado,
    descargaCaptura,
    materialId,
    toneladas,
    ticket,
    km,
    kmEditadoManual,
    rotaGeometriaEscolhida,
    rotaIdx,
    valorPedagio,
    observacao,
    foto,
  ]);

  function validar(): boolean {
    if (!localDescargaId) {
      val.apontar("descarga", "Marque o local de descarga");
      return false;
    }
    if (!materialId) {
      val.apontar("material", "Escolha o material");
      return false;
    }
    if (!km.trim()) {
      val.apontar("km", "Informe os km rodados");
      return false;
    }
    if (exigeTicket && !ticket.trim()) {
      val.apontar("ticket", "Informe o número do ticket");
      return false;
    }
    if (!toneladas.trim()) {
      val.apontar("toneladas", "Informe as toneladas");
      return false;
    }
    return true;
  }

  async function salvar() {
    setErro(null);
    if (!validar()) return;
    val.limpar();
    setSubmitting(true);
    try {
      const localDescargaDados =
        descargaCaptura != null
          ? {
              nome: nomeDescargaSelecionado ?? "Local de descarga",
              lat: descargaCaptura.lat,
              lng: descargaCaptura.lng,
            }
          : undefined;

      await finalizarViagemGuiada({
        clienteId,
        materialId,
        data: hojeISO(),
        toneladas: parseFloat(toneladas.replace(",", ".")),
        km: parseFloat(km.replace(",", ".")),
        kmCalculado: kmRecomendado,
        kmEditadoManual,
        rotaGeometria: rotaGeometriaEscolhida ?? undefined,
        ticket: exigeTicket ? ticket.trim() : undefined,
        localDescargaId,
        localDescargaDados,
        descargaLat: descargaCaptura?.lat,
        descargaLng: descargaCaptura?.lng,
        descargaPrecisao: descargaCaptura?.precisao ?? undefined,
        descargaFonte: descargaCaptura?.fonte,
        descargaRaioUsadoM: descargaCaptura?.raioUsadoM,
        descargaDistanciaMetros: descargaCaptura?.distanciaMetros ?? undefined,
        valorPedagioTotal: valorPedagio
          ? parseFloat(valorPedagio.replace(",", "."))
          : undefined,
        observacao: observacao.trim() || undefined,
        foto: foto ? { uri: foto.uri, mime: foto.mime } : undefined,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await showAlert({
        title: "Viagem finalizada!",
        message: "Vamos enviar assim que tiver sinal. Bom trabalho.",
      });
      router.replace("/");
    } catch (err) {
      setErro(humanizeApiError(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSubmitting(false);
    }
  }

  if (carregando || (cat.isLoading && !cat.data)) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator />
        <Text className="mt-3 text-base text-muted-foreground">Carregando…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Finalizar viagem" />

      {!cat.data ? (
        <SemCatalogo carregando={cat.isFetching} aoBaixar={() => void cat.refetch()} />
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            ref={val.scrollRef}
            contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* 1) Onde descarregou — captura já dispara sozinha ao abrir a tela
                   (o motorista veio do "Finalizar viagem" acabando de descarregar). */}
            <View
              className={
                val.erroDe("descarga")
                  ? "rounded-2xl border-2 border-destructive bg-destructive/5 p-3"
                  : undefined
              }
              onLayout={val.onLayoutCampo("descarga")}
            >
              <DescargaPorGps
                autoIniciar={!localDescargaId}
                clienteId={clienteId || null}
                value={localDescargaId}
                onChange={(x) => {
                  val.limpar();
                  setLocalDescargaId(x);
                  // Nova descarga = nova rota; reseta a escolha pra re-defaultar.
                  setRotaGeometriaEscolhida(null);
                  setRotaIdx(0);
                }}
                onCaptura={setDescargaCaptura}
                nomeSelecionadoFallback={nomeDescargaSelecionado}
                localCargaCoords={localCargaCoords}
              />
              {val.erroDe("descarga") ? <ErroCampo msg={val.erroDe("descarga")!} /> : null}
            </View>

            {/* 2) Cliente (já escolhido no início) + material */}
            <View className="gap-1.5">
              <Label>Cliente</Label>
              <View className="rounded-xl border border-border bg-muted/40 px-3 py-3">
                <Text className="text-base font-semibold text-foreground">
                  {ciclo?.clienteNome ?? "—"}
                </Text>
              </View>
            </View>

            <View className="gap-2" onLayout={val.onLayoutCampo("material")}>
              <Label error={!!val.erroDe("material")}>Material</Label>
              <Select
                value={materialId}
                onChange={(x) => {
                  val.limpar();
                  setMaterialId(x);
                }}
                options={materialOptions}
                placeholder="Escolha o material"
                searchable
                error={!!val.erroDe("material")}
              />
              {val.erroDe("material") ? (
                <ErroCampo msg={val.erroDe("material")!} />
              ) : !exigeTicket && materialId ? (
                <Text className="text-xs text-muted-foreground">
                  Esse material não exige ticket — pode lançar sem número.
                </Text>
              ) : null}
            </View>

            {/* Mapa da rota — informativo com 1 rota, seletor com 2+ */}
            {temMapa ? (
              <SeletorRotas
                rotas={alternativas.data!}
                selecionadaIdx={rotaIdx}
                onSelecionar={escolherRota}
              />
            ) : null}

            {/* 3) Km e pedágio */}
            <View className="gap-2" onLayout={val.onLayoutCampo("km")}>
              <View className="flex-row gap-3">
                <View className="flex-1 gap-2">
                  <Label error={!!val.erroDe("km")}>Km rodados</Label>
                  <Input
                    value={km}
                    onChangeText={(v) => {
                      val.limpar();
                      setKmEditadoManual(true);
                      setKm(v);
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0,00"
                    maxLength={8}
                    error={!!val.erroDe("km")}
                  />
                  {rota.isFetching && !kmEditadoManual ? (
                    <Text className="text-xs text-muted-foreground">Calculando rota…</Text>
                  ) : rota.data &&
                    "km" in rota.data &&
                    rota.data.km &&
                    !kmEditadoManual &&
                    rota.data.fonte !== "estimado_haversine" ? (
                    <Text className="text-xs font-medium text-success">
                      ✓ Calculado ({rota.data.km} km)
                    </Text>
                  ) : null}
                </View>
                <View className="flex-1 gap-2">
                  <Label>Pedágio (R$)</Label>
                  <Input
                    value={valorPedagio}
                    onChangeText={setValorPedagio}
                    keyboardType="decimal-pad"
                    placeholder="opcional"
                    maxLength={10}
                  />
                </View>
              </View>
              {/* Aviso de km estimado em LINHA INTEIRA (abaixo da linha km+pedágio),
                  senão fica espremido na coluna estreita do km. */}
              {rota.data &&
              "km" in rota.data &&
              rota.data.km &&
              !kmEditadoManual &&
              rota.data.fonte === "estimado_haversine" ? (
                <AvisoKmEstimado km={rota.data.km} />
              ) : null}
              {val.erroDe("km") ? <ErroCampo msg={val.erroDe("km")!} /> : null}
            </View>

            {/* 4) Ticket (se o material exigir) + foto */}
            {exigeTicket && (
              <View className="gap-2" onLayout={val.onLayoutCampo("ticket")}>
                <Label error={!!val.erroDe("ticket")}>Ticket</Label>
                <Input
                  value={ticket}
                  onChangeText={(v) => {
                    val.limpar();
                    setTicket(v.toUpperCase());
                  }}
                  placeholder="número"
                  maxLength={50}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  error={!!val.erroDe("ticket")}
                />
                {val.erroDe("ticket") ? <ErroCampo msg={val.erroDe("ticket")!} /> : null}
              </View>
            )}

            <View className="gap-2">
              <Label>Foto do ticket</Label>
              <PhotoCapture value={foto} onChange={setFoto} />
              <Text className="text-xs text-muted-foreground">
                Opcional, mas ajuda na conferência.
              </Text>
            </View>

            {/* 5) Por último: toneladas e observação */}
            <View className="gap-2" onLayout={val.onLayoutCampo("toneladas")}>
              <Label error={!!val.erroDe("toneladas")}>Toneladas</Label>
              <Input
                value={toneladas}
                onChangeText={(v) => {
                  val.limpar();
                  setToneladas(v);
                }}
                keyboardType="decimal-pad"
                placeholder="0,000"
                maxLength={8}
                error={!!val.erroDe("toneladas")}
              />
              {val.erroDe("toneladas") ? <ErroCampo msg={val.erroDe("toneladas")!} /> : null}
            </View>

            <View className="gap-2">
              <Label>Observação</Label>
              <Input
                value={observacao}
                onChangeText={setObservacao}
                placeholder="opcional"
                maxLength={500}
              />
            </View>

            {erro ? <ErroCampo msg={erro} /> : null}

            <Button
              size="lg"
              className="h-20 bg-success"
              onPress={salvar}
              loading={submitting}
            >
              <Flag size={24} color="white" />
              <Text className="text-xl font-bold text-primary-foreground">
                {submitting ? "Finalizando…" : "Finalizar viagem"}
              </Text>
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
