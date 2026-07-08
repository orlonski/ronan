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
import { SeletorRetorno } from "@/components/seletor-retorno";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { SemCatalogo } from "@/components/sem-catalogo";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { AvisoKmEstimado } from "@/components/aviso-km-estimado";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert, showConfirm } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { hojeISO } from "@/lib/datetime";
import {
  finalizarViagemGuiada,
  getLifecycleLocal,
  salvarFinalizarDraft,
  type LifecycleLocal,
} from "@/lib/lifecycle";
import {
  useCalcularRota,
  useCatalogos,
  useRotasAlternativas,
  useOpcoesRota,
} from "@/lib/queries";

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
  const [descargaEm, setDescargaEm] = useState<string | undefined>(undefined);
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
        if (d.descargaEm) setDescargaEm(d.descargaEm);
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
  // Variantes COM retorno vs SEM retorno (curb). Se vierem 2, têm precedência
  // sobre as alternativas de estrada: o motorista confirma se voltou no retorno.
  const opcoesRetorno = useOpcoesRota(localCargaId, localDescargaId);
  const usarRetorno = (opcoesRetorno.data?.length ?? 0) >= 2;
  // Alternativas de estrada — só DEPOIS que /opcoes resolveu e não há retorno.
  // Sequenciar evita corrida entre as fontes e mantém uma fonte única estável.
  const buscarAlternativas = !usarRetorno && opcoesRetorno.isFetched;
  const alternativas = useRotasAlternativas(
    buscarAlternativas ? localCargaId : undefined,
    buscarAlternativas ? localDescargaId : undefined,
  );
  // Fonte ÚNICA que governa km/geometria (retorno vence estrada). Memoizado pra
  // referência estável (evita recomputar kmRecomendado / re-rodar o effect à toa).
  const rotasAtivas = useMemo(
    () => (usarRetorno ? opcoesRetorno.data! : alternativas.data ?? []),
    [usarRetorno, opcoesRetorno.data, alternativas.data],
  );
  const temMapa = rotasAtivas.length >= 1;
  // km da recomendada — snapshot pra kmCalculado quando não há escolha ativa.
  const kmRecomendado = useMemo(() => {
    const rec = rotasAtivas.find((r) => r.recomendada);
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
  }, [rotasAtivas, rota.data]);

  // Escolher uma rota no seletor: seta km + guarda a geometria (rota real no
  // painel). NÃO marca edição manual (escolher ≠ digitar na mão).
  function escolherRota(idx: number) {
    const r = rotasAtivas[idx];
    if (!r) return;
    setRotaIdx(idx);
    setRotaGeometriaEscolhida(r.geometria);
    setKm(r.km);
  }

  // Enquanto o seletor governa o km (rota escolhida), o auto-fill fica parado.
  const kmGovernadoPorRota = temMapa && rotaGeometriaEscolhida != null;

  // INVARIANTE anti-divergência: quando o seletor governa, kmCalculado = km da
  // opção ESCOLHIDA (não a recomendada fixa) → km == kmCalculado, nada dispara.
  const kmCalculadoFinal =
    kmGovernadoPorRota && rotasAtivas[rotaIdx]
      ? parseFloat(rotasAtivas[rotaIdx]!.km)
      : kmRecomendado;

  // Escolha "voltei no retorno" (true) vs "segui direto" (false); undefined quando
  // não perguntado (backend grava null). O recalcular do painel respeita.
  const retornoConfirmado =
    usarRetorno && rotaGeometriaEscolhida != null
      ? rotasAtivas[rotaIdx]?.retorno
      : undefined;
  useEffect(() => {
    if (kmEditadoManual || kmGovernadoPorRota) return;
    if (!rota.data || rota.data.km === null) return;
    setKm((cur) => (cur === rota.data!.km ? cur : (rota.data as { km: string }).km));
  }, [rota.data, kmEditadoManual, kmGovernadoPorRota]);

  // Pré-seleciona da fonte ativa (1+); preserva a escolha restaurada do rascunho.
  // No card de RETORNO o default é o conservador "Cheguei direto" — o sistema não
  // entrega km a mais de graça; quem voltou toca na opção. Estrada: a recomendada.
  useEffect(() => {
    if (kmEditadoManual || rotaGeometriaEscolhida != null) return;
    if (rotasAtivas.length < 1) return;
    const idx = usarRetorno
      ? rotasAtivas.findIndex((r) => r.retorno === false)
      : rotasAtivas.findIndex((r) => r.recomendada);
    escolherRota(Math.max(0, idx));
  }, [rotasAtivas, kmEditadoManual, rotaGeometriaEscolhida]); // eslint-disable-line react-hooks/exhaustive-deps

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
        descargaEm,
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
    descargaEm,
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

  // Valida tudo que NÃO é peso/ticket (esses podem ficar pra depois, no modo
  // "aguardando peso"). Aponta o 1º campo faltando na ordem da tela.
  function validarBase(): boolean {
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
    return true;
  }

  async function salvar() {
    setErro(null);
    // Primeiro valida tudo menos peso/ticket. Só quando o resto está pronto é
    // que o peso faltando vira a pergunta (nunca no meio do preenchimento).
    if (!validarBase()) return;

    // Se falta o peso, pode ser que o romaneio só saia no fim do dia — oferece
    // finalizar sem peso e completar depois (mesmo fluxo da nova viagem).
    let aguardandoPeso = false;
    if (!toneladas.trim()) {
      const escolha = await showAlert({
        title: "Você já tem o peso?",
        message:
          "Se o peso e o romaneio (ticket) só saem no fim do dia, dá pra finalizar a viagem agora e completar depois — a gente te lembra.",
        variant: "warning",
        buttons: [
          { label: "Tenho o peso agora", value: "tenho", style: "default" },
          { label: "O peso sai no fim do dia", value: "depois", style: "outline" },
        ],
      });
      if (escolha === "depois") {
        aguardandoPeso = true;
      } else {
        val.apontar("toneladas", "Informe as toneladas");
        return;
      }
    }
    // Peso presente e não é aguardando peso: ticket segue as regras normais.
    if (!aguardandoPeso && exigeTicket && !ticket.trim()) {
      val.apontar("ticket", "Informe o número do ticket");
      return;
    }
    val.limpar();
    // Confirmação final do km — cálculo automático pela rota, valor do motorista
    // prevalece. Offline: avisa que é estimativa e recalcula quando a internet voltar.
    const kmEstimado =
      !!rota.data && "fonte" in rota.data && rota.data.fonte === "estimado_haversine";
    const kmConfirmado = await showConfirm({
      title: `Você rodou ${km.replace(".", ",")} km?`,
      message: kmEstimado
        ? "Você está sem internet, então esse km é só uma ESTIMATIVA (linha reta). Quando a internet voltar, o sistema recalcula pela rota certa. Se você já sabe quanto rodou, toque em Alterar e informe — aí vale o seu."
        : "Esse km foi calculado automático pela rota. Se você rodou diferente, toque em Alterar e corrija — o que você confirmar é o que vale.",
      confirmLabel: "Sim, está certo",
      cancelLabel: "Alterar o km",
    });
    if (!kmConfirmado) {
      val.apontar("km", "Ajuste o km rodado aqui");
      return;
    }
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
        // Aguardando peso: finaliza sem toneladas/ticket (romaneio no fim do dia).
        toneladas: aguardandoPeso
          ? undefined
          : parseFloat(toneladas.replace(",", ".")),
        aguardandoPeso,
        km: parseFloat(km.replace(",", ".")),
        // Quando o seletor governa, é o km da opção escolhida (== km) → sem divergência.
        kmCalculado: kmCalculadoFinal,
        kmEditadoManual,
        rotaGeometria: rotaGeometriaEscolhida ?? undefined,
        retornoConfirmado,
        ticket: aguardandoPeso ? undefined : exigeTicket ? ticket.trim() : undefined,
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
        title: aguardandoPeso ? "Viagem finalizada — falta o peso" : "Viagem finalizada!",
        message: aguardandoPeso
          ? "Enviamos assim que tiver sinal. Quando sair o romaneio, complete o peso e o ticket — a gente te lembra."
          : "Vamos enviar assim que tiver sinal. Bom trabalho.",
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
                  // Marca quando a descarga foi escolhida (pra mostrar data/hora
                  // no espelho, igual à carga). Limpa se desmarcou.
                  setDescargaEm(x ? new Date().toISOString() : undefined);
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

            {/* Mapa da rota — escolha de retorno (2 opções) ou de estrada */}
            {temMapa ? (
              usarRetorno ? (
                <SeletorRetorno
                  opcoes={rotasAtivas}
                  selecionadaIdx={rotaIdx}
                  onSelecionar={escolherRota}
                />
              ) : (
                <SeletorRotas
                  rotas={rotasAtivas}
                  selecionadaIdx={rotaIdx}
                  onSelecionar={escolherRota}
                />
              )
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
