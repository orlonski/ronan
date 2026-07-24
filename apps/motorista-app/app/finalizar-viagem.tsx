import { useEffect, useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { Flag } from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { DescargaPorGps, type DescargaCaptura } from "@/components/descarga-por-gps";
import { SeletorRotas } from "@/components/seletor-rotas";
import { PerguntaBotaFora } from "@/components/pergunta-bota-fora";
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
import { avaliarKm, type KmFonte } from "@ronan/shared-types";
import {
  finalizarViagemGuiada,
  getLifecycleLocal,
  salvarFinalizarDraft,
  type LifecycleLocal,
} from "@/lib/lifecycle";
import {
  useCalcularRota,
  useCatalogos,
  useReferenciaKm,
  useRotasAlternativas,
  useOpcoesRota,
} from "@/lib/queries";
import { AvisoKmForaDoPadrao, SugestaoKmHistorico } from "@/components/sugestao-km-historico";

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
  // Procedência do km (ver nova-viagem): distingue "usou o histórico da frota"
  // de "ajustou na mão". null = não mexeu → resolve por contexto no payload.
  const [kmFonte, setKmFonte] = useState<KmFonte | null>(null);
  const [exigirJustificativa, setExigirJustificativa] = useState(false);
  // Bota-fora (limpeza): motorista voltou pro local de carga pra jogar a sobra.
  const [teveBotaFora, setTeveBotaFora] = useState(false);
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
        if (d.teveBotaFora) setTeveBotaFora(true);
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

  // Material libera "voltar pro bota-fora" (limpeza)? Só então mostra a pergunta.
  const permiteBotaFora = useMemo(() => {
    const m = cat.data?.materiais.find((x) => x.id === materialId);
    return m?.permiteBotaFora ?? false;
  }, [cat.data?.materiais, materialId]);
  // Efetivo: só conta se o material permite E o motorista marcou.
  const botaFora = permiteBotaFora && teveBotaFora;

  // KM auto via OSRM entre local de carga (se cadastrado) e descarga.
  const localCargaId = ciclo?.localCargaId ?? "";
  const rota = useCalcularRota(localCargaId, localDescargaId);
  // Alternativas de estrada — o km sai sempre da rota direta calculada
  // (recomendada) e o motorista pode escolher outra estrada no mapa.
  const alternativas = useRotasAlternativas(localCargaId, localDescargaId);
  // Bota-fora: volta descarga→carga (variante direta). Só busca quando marcado.
  const opcoesVolta = useOpcoesRota(
    botaFora ? localDescargaId : undefined,
    botaFora ? localCargaId : undefined,
  );
  // Fonte ÚNICA que governa km/geometria. Memoizado pra referência estável
  // (evita recomputar kmRecomendado / re-rodar o effect à toa).
  const rotasAtivas = useMemo(
    () => alternativas.data ?? [],
    [alternativas.data],
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

  // Referência de km do trajeto (o que a frota já rodou nesse par).
  const refKm = useReferenciaKm(localCargaId, localDescargaId);
  const sugestaoKm = useMemo(() => {
    const ref = refKm.data;
    if (!ref?.efetiva || ref.efetiva.fonte !== "HISTORICO" || !ref.historico) return null;
    return {
      km: ref.efetiva.km,
      amostra: ref.historico.amostra,
      min: ref.historico.min,
      max: ref.historico.max,
    };
  }, [refKm.data]);
  const semSinal =
    !!rota.data &&
    "fonte" in rota.data &&
    (rota.data.fonte === "estimado_haversine" || rota.data.fonte === "cache_local");
  const kmAtualNum = parseFloat(km.replace(",", "."));
  const sugestaoJaAplicada =
    sugestaoKm != null &&
    Number.isFinite(kmAtualNum) &&
    Math.abs(kmAtualNum - sugestaoKm.km) < 0.5;
  // Renderiza sempre que há amostra; km já batendo vira confirmação compacta.
  const mostrarSugestao = sugestaoKm != null;

  const avaliacao = useMemo(
    () => avaliarKm(kmAtualNum, refKm.data ?? null),
    [kmAtualNum, refKm.data],
  );
  const kmForaDoPadrao = avaliacao?.foraDoPadrao === true;

  // Banner informativo de km fora do padrão (a explicação é exigida na
  // observação, não aqui). Some quando o motorista já explicou na observação.
  const bannerKmForaDoPadrao =
    kmForaDoPadrao && avaliacao && observacao.trim().length < 5 ? (
      <AvisoKmForaDoPadrao referencia={avaliacao.referencia} />
    ) : null;

  useEffect(() => {
    setKmFonte(null);
    setExigirJustificativa(false);
  }, [localCargaId, localDescargaId]);

  // Escolher rota/variante: seta km + geometria e SAI do modo manual.
  function escolherRota(idx: number) {
    const r = rotasAtivas[idx];
    if (!r) return;
    setKmEditadoManual(false);
    setKmFonte("ROTA_ESCOLHIDA");
    setRotaIdx(idx);
    setRotaGeometriaEscolhida(r.geometria);
    setKm(r.km);
  }

  // Aceitou a sugestão do histórico da frota (mesmo comportamento da nova viagem).
  function usarSugestaoKm(kmSugerido: number) {
    setRotaIdx(-1);
    setRotaGeometriaEscolhida(null);
    setKmEditadoManual(true);
    setKmFonte("HISTORICO");
    setKm(formatKmInput(kmSugerido));
  }

  // Enquanto o seletor governa o km (rota escolhida), o auto-fill fica parado.
  const kmGovernadoPorRota = temMapa && rotaGeometriaEscolhida != null;

  // INVARIANTE anti-divergência: quando o seletor governa, kmCalculado = km da
  // opção ESCOLHIDA (não a recomendada fixa) → km == kmCalculado, nada dispara.
  const kmCalculadoFinal =
    kmGovernadoPorRota && rotasAtivas[rotaIdx]
      ? parseFloat(rotasAtivas[rotaIdx]!.km)
      : kmRecomendado;

  // Bota-fora: km da volta pela variante direta (sem retorno). Ida e volta na
  // mesma régua (km direto calculado automaticamente).
  const kmVolta = useMemo(() => {
    if (!botaFora) return null;
    const opts = opcoesVolta.data ?? [];
    if (opts.length === 0) return null;
    const alvo = opts.find((r) => r.retorno === false);
    const escolhida = alvo ?? opts.find((r) => r.recomendada) ?? opts[0];
    return escolhida ? parseFloat(escolhida.km) : null;
  }, [botaFora, opcoesVolta.data]);
  // Auto-preenche o km com o valor calculado pela rota, se motorista não editou.
  useEffect(() => {
    if (kmEditadoManual || kmGovernadoPorRota) return;
    if (!rota.data || rota.data.km === null) return;
    setKm((cur) => (cur === rota.data!.km ? cur : (rota.data as { km: string }).km));
  }, [rota.data, kmEditadoManual, kmGovernadoPorRota]);

  // Pré-seleciona a recomendada no seletor de estrada. Preserva a escolha
  // restaurada do rascunho.
  useEffect(() => {
    if (kmEditadoManual || rotaGeometriaEscolhida != null) return;
    if (rotasAtivas.length < 1) return;
    const recIdx = Math.max(0, rotasAtivas.findIndex((r) => r.recomendada));
    escolherRota(recIdx);
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
        teveBotaFora,
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
    teveBotaFora,
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
    // Observação obrigatória quando mexeu no km (MANUAL) ou km atípico + insistiu.
    const kmMexido = kmFonte === "MANUAL";
    if ((kmMexido || exigirJustificativa) && observacao.trim().length < 5) {
      val.apontar(
        "observacao",
        kmMexido
          ? "Você mudou o km calculado. Explique aqui na observação por quê."
          : "Km fora do padrão do trajeto. Explique aqui na observação.",
      );
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
    // Peso presente: valida o máximo ANTES de enfileirar. O backend recusa
    // toneladas > 9999 com 400; sem esse guard o valor errado (ex: digitou
    // 38230 sem vírgula em vez de 38,230) entrava no outbox e o finalize ficava
    // preso. Pega na origem.
    if (!aguardandoPeso) {
      const t = parseFloat(toneladas.replace(",", "."));
      if (Number.isNaN(t) || t <= 0) {
        val.apontar("toneladas", "Informe as toneladas");
        return;
      }
      if (t > 9999) {
        val.apontar("toneladas", "Toneladas acima do limite (9999)");
        return;
      }
    }
    // Peso presente e não é aguardando peso: ticket segue as regras normais.
    if (!aguardandoPeso && exigeTicket && !ticket.trim()) {
      val.apontar("ticket", "Informe o número do ticket");
      return;
    }

    // Km fora do padrão: avisa uma vez; se insistir, exige a explicação na
    // observação. Pula quando a observação já foi preenchida (não cobra 2x).
    if (
      kmForaDoPadrao &&
      avaliacao &&
      !exigirJustificativa &&
      observacao.trim().length < 5
    ) {
      const r = await showAlert({
        title: "Km fora do padrão",
        message: `As outras viagens desse trajeto deram ≈${formatKmInput(
          avaliacao.referencia,
        )} km. Você marcou ${km.replace(".", ",")} km.`,
        variant: "warning",
        buttons: [
          { label: "Rever o km", value: "rever", style: "cancel" },
          { label: "Está certo, seguir", value: "seguir", style: "outline" },
        ],
      });
      if (r !== "seguir") {
        val.apontar("km", "Confira os km rodados");
        return;
      }
      setExigirJustificativa(true);
      val.apontar("observacao", "Explique aqui na observação por que o km ficou diferente");
      return;
    }

    val.limpar();
    // Bota-fora: km faturável = ida + volta. Quando não marcou, kmVolta é null e
    // o total colapsa na ida (comportamento de sempre).
    const kmBaseNum = parseFloat(km.replace(",", ".")) || 0;
    const kmTotalNum = kmBaseNum + (kmVolta ?? 0);
    // Confirmação final do km. Cálculo automático, valor do motorista prevalece.
    // SEM INTERNET (haversine OU cache do aparelho): avisa em destaque (warning).
    const fonteRota = rota.data && "fonte" in rota.data ? rota.data.fonte : null;
    const semNet = fonteRota === "estimado_haversine" || fonteRota === "cache_local";
    const msgKm =
      fonteRota === "estimado_haversine"
        ? "⚠️ Você está SEM INTERNET. Esse km é só uma ESTIMATIVA por linha reta — pode não bater com a estrada. Quando a internet voltar, o sistema recalcula pela rota certa. Se você já sabe quanto rodou, toque em Alterar e informe."
        : fonteRota === "cache_local"
          ? "⚠️ Você está SEM INTERNET. Esse km veio de um cálculo ANTERIOR dessa rota, salvo no aparelho (cache). Quando a internet voltar, o sistema confere pela rota certa. Se você já sabe quanto rodou, toque em Alterar e informe."
          : "Esse km foi calculado automático pela rota. Se você rodou diferente, toque em Alterar e corrija — o que você confirmar é o que vale.";
    // Km fora do padrão já passou pelo pop-up próprio (+ justificativa) — não
    // repete a confirmação genérica.
    const kmConfirmado = kmForaDoPadrao
      ? true
      : await showConfirm({
          title:
            botaFora && kmVolta != null
              ? `Você rodou ${kmTotalNum.toFixed(2).replace(".", ",")} km? (ida + volta)`
              : `Você rodou ${km.replace(".", ",")} km?`,
          message: msgKm,
          variant: semNet ? "warning" : "default",
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
        km: kmTotalNum,
        // Quando o seletor governa, é o km da opção escolhida (== km) → sem divergência.
        // Bota-fora: só manda kmCalculado (ida+volta) quando as DUAS pernas vieram
        // de rota real; senão fica undefined pro backend reprocessar.
        kmCalculado: botaFora
          ? kmCalculadoFinal != null && kmVolta != null
            ? kmCalculadoFinal + kmVolta
            : undefined
          : kmCalculadoFinal,
        kmEditadoManual,
        kmFonte:
          kmFonte ??
          (kmEditadoManual
            ? "MANUAL"
            : kmGovernadoPorRota
              ? "ROTA_ESCOLHIDA"
              : "ROTA_OSRM"),
        rotaGeometria: rotaGeometriaEscolhida ?? undefined,
        // Bota-fora = 1 trecho de retorno pro local de carga (a volta que ele fez).
        trechos:
          botaFora && kmVolta != null && localCargaId
            ? [{ tipo: "RETORNO_BOTA_FORA", localId: localCargaId, km: kmVolta }]
            : undefined,
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
          behavior="padding"
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
                  // Nova descarga = nova rota; zera a escolha (nada marcado).
                  setRotaGeometriaEscolhida(null);
                  setRotaIdx(-1);
                  setKmEditadoManual(false);
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

            {/* Sugestão do histórico da frota — no topo da seção de km. */}
            {mostrarSugestao && sugestaoKm ? (
              <SugestaoKmHistorico
                km={sugestaoKm.km}
                amostra={sugestaoKm.amostra}
                min={sugestaoKm.min}
                max={sugestaoKm.max}
                offline={semSinal}
                confirmado={sugestaoJaAplicada}
                onUsar={() => usarSugestaoKm(sugestaoKm.km)}
              />
            ) : null}

            {/* Seletor de estrada (escolha da rota no mapa) */}
            {temMapa ? (
              <SeletorRotas
                rotas={rotasAtivas}
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
                      setKmFonte("MANUAL");
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
                    (rota.data.fonte === "osrm" ||
                      rota.data.fonte === "cache_server") ? (
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
              {!mostrarSugestao &&
              rota.data &&
              "km" in rota.data &&
              rota.data.km &&
              !kmEditadoManual &&
              (rota.data.fonte === "estimado_haversine" ||
                rota.data.fonte === "cache_local") ? (
                <AvisoKmEstimado km={rota.data.km} fonte={rota.data.fonte} />
              ) : null}
              {val.erroDe("km") ? <ErroCampo msg={val.erroDe("km")!} /> : null}
              {bannerKmForaDoPadrao}
            </View>

            {/* Bota-fora (limpeza): só quando o material permite */}
            {permiteBotaFora ? (
              <PerguntaBotaFora
                valor={teveBotaFora}
                onMudar={setTeveBotaFora}
                kmBase={parseFloat(km.replace(",", ".")) || 0}
                kmVolta={kmVolta}
                carregando={botaFora && opcoesVolta.isFetching}
              />
            ) : null}

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

            <View
              className="gap-2"
              ref={val.refCampo("observacao")}
              onLayout={val.onLayoutCampo("observacao")}
            >
              <Label error={!!val.erroDe("observacao")}>
                Observação{" "}
                <Text className="text-sm font-normal text-muted-foreground">
                  {kmFonte === "MANUAL" || exigirJustificativa
                    ? "— explique a mudança do km"
                    : "(opcional)"}
                </Text>
              </Label>
              <Input
                value={observacao}
                onChangeText={(v) => {
                  val.limpar();
                  setObservacao(v);
                }}
                placeholder={
                  kmFonte === "MANUAL" || exigirJustificativa
                    ? "Ex.: desvio por obra na rodovia"
                    : "opcional"
                }
                maxLength={500}
                multiline
                error={!!val.erroDe("observacao")}
              />
              {val.erroDe("observacao") ? (
                <ErroCampo msg={val.erroDe("observacao")!} />
              ) : null}
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

/** Km (number) → string do input: sem casas quando inteiro, 1 casa com vírgula. */
function formatKmInput(km: number): string {
  const arred = Math.round(km * 10) / 10;
  return Number.isInteger(arred) ? String(arred) : arred.toFixed(1).replace(".", ",");
}
