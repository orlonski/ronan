import { useEffect, useMemo, useRef, useState } from "react";
import { router, Stack, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { Check, MapPinOff, Trash2, X } from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { SemCatalogo } from "@/components/sem-catalogo";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { AvisoKmEstimado } from "@/components/aviso-km-estimado";
import { AvisoKmForaDoPadrao, SugestaoKmHistorico } from "@/components/sugestao-km-historico";
import { DescargaPorGps, type DescargaCaptura } from "@/components/descarga-por-gps";
import { SeletorRotas } from "@/components/seletor-rotas";
import { SeletorRetorno } from "@/components/seletor-retorno";
import { PerguntaBotaFora } from "@/components/pergunta-bota-fora";
import { showAlert, showConfirm } from "@/lib/alert";
import { clearNavDestino } from "@/lib/nav-destino-storage";
import { humanizeApiError } from "@/lib/api";
import { fmtDataBR, hojeISO } from "@/lib/datetime";
import { reportarEvento } from "@/lib/event-reporter";
import { criarTelemetriaViagem } from "@/lib/telemetria-viagem";
import { humanizeZodError } from "@/lib/validation";
import { avaliarKm, CriarViagemInput, type KmFonte } from "@ronan/shared-types";
import { formatarDistancia, haversineMetros, localMaisProximo, pegarCoordsPrecisa, pegarCoordsRapido } from "@/lib/geo";
import { simplificarPontos } from "@/lib/polyline";
import { listPendingViagens, type PendingViagem } from "@/db/database";
import * as FileSystem from "expo-file-system/legacy";
import type { ExtrairTicketResult } from "@ronan/shared-types";
import { atualizarViagemPendente } from "@/lib/sync";
import {
  useCalcularRota,
  useCatalogos,
  useCriarViagem,
  useExtrairTicket,
  useMe,
  usePedagiosNaRota,
  useReferenciaKm,
  useRotasAlternativas,
  useOpcoesRota,
  type Local,
} from "@/lib/queries";

type FormShape = {
  veiculoId: string;
  clienteId: string;
  materialId: string;
  data: string;
  toneladas: string;
  ticket: string;
  km: string;
  localCargaId: string;
  localDescargaId: string;
  valorPedagio: string;
  observacao: string;
};

const today = hojeISO;

function numToStr(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}

/** Km (number) → string do input: sem casas quando inteiro, 1 casa com vírgula. */
function formatKmInput(km: number): string {
  const arred = Math.round(km * 10) / 10;
  return Number.isInteger(arred) ? String(arred) : arred.toFixed(1).replace(".", ",");
}

const empty: FormShape = {
  veiculoId: "",
  clienteId: "",
  materialId: "",
  data: today(),
  toneladas: "",
  ticket: "",
  km: "",
  localCargaId: "",
  localDescargaId: "",
  valorPedagio: "",
  observacao: "",
};

type TrackingPayload = {
  id: string;
  iniciadoEm: string;
  kmReal: string;
  pontos: { lat: number; lng: number; capturadoEm: string; velocidade?: number; precisao?: number }[];
};

export default function NovaViagem() {
  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarViagem();
  const params = useLocalSearchParams<{
    fromTracking?: string;
    trackingData?: string;
    editarClientId?: string;
    // Destino escolhido na navegação (viagem-andamento) = a descarga. Vem
    // pré-preenchido pra NÃO perguntar de novo o que o motorista já escolheu.
    descargaId?: string;
    // Coordenada precisa da carga (fix do início) — conserta a corrida do GPS
    // de largada quando o motorista finaliza rápido.
    cargaLat?: string;
    cargaLng?: string;
  }>();
  const modoEdit = !!params.editarClientId;

  // Dados do tracking GPS, se motorista veio da tela "Viagem em andamento"
  const tracking = useMemo<TrackingPayload | null>(() => {
    if (params.fromTracking !== "1" || !params.trackingData) return null;
    try {
      return JSON.parse(params.trackingData) as TrackingPayload;
    } catch {
      return null;
    }
  }, [params.fromTracking, params.trackingData]);

  const [form, setForm] = useState<FormShape>(() =>
    tracking
      ? { ...empty, km: tracking.kmReal, localDescargaId: params.descargaId ?? "" }
      : empty,
  );
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  // clientId da viagem gerado JÁ no início da sessão (estável) pra:
  // (a) taggear a telemetria de interação (viagemClientId → reconcilia no backend);
  // (b) ser o mesmo id usado no submit (idempotência do outbox).
  const viagemClientId = useMemo(
    () => (modoEdit ? params.editarClientId! : makeUuid()),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Telemetria opt-in (flag podeTelemetria). NO-OP quando off — custo zero.
  const tele = useMemo(
    () => criarTelemetriaViagem(me.data?.podeTelemetria ?? false, viagemClientId),
    [me.data?.podeTelemetria, viagemClientId],
  );
  const [sugestoesIa, setSugestoesIa] = useState<ExtrairTicketResult | null>(null);
  // Campos preenchidos pela IA e mantidos pelo motorista até o submit.
  const [ocrCampos, setOcrCampos] = useState<Set<string>>(new Set());
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const extrairTicket = useExtrairTicket();
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const val = useValidacaoGuiada();
  // Locais criados nesta sessão — merged no Select pra garantir que aparecem
  // mesmo se o cache do TanStack Query ainda não propagou
  const [extraLocais, setExtraLocais] = useState<Local[]>([]);
  // GPS pré-aquecido em background — modulo carrega + permissao + fix
  // enquanto motorista preenche o form. Quando toca Salvar, usa o que ja tem.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Snapshot do GPS quando o motorista marcou a descarga (auditoria). Reseta
  // ao trocar (onCaptura(null)). Não persiste em edição de viagem já sincronizada.
  const [descargaCaptura, setDescargaCaptura] = useState<DescargaCaptura | null>(null);
  // Rastreia se motorista editou KM manualmente — se sim, parou de auto-preencher
  const [kmEditadoManual, setKmEditadoManual] = useState(false);
  // Procedência do km escolhida explicitamente pelo motorista (rota, mão ou
  // sugestão histórica). null = não mexeu → o payload resolve pra OSRM/rota.
  // HISTORICO precisa ser distinguido de MANUAL: usar a referência da frota NÃO
  // é "ajustou na mão" e não pode virar alerta de divergência no painel.
  const [kmFonte, setKmFonte] = useState<KmFonte | null>(null);
  // Rede de segurança: quando o motorista insiste num km fora do padrão, o campo
  // de justificativa aparece e vira obrigatório.
  const [exigirJustificativa, setExigirJustificativa] = useState(false);
  // Bota-fora (limpeza): motorista voltou pro local de carga pra jogar a sobra.
  const [teveBotaFora, setTeveBotaFora] = useState(false);
  // Rota escolhida no seletor de mapa (quando há alternativas).
  const [rotaIdx, setRotaIdx] = useState(0);
  const [rotaGeometriaEscolhida, setRotaGeometriaEscolhida] = useState<string | null>(null);

  // Modo edit: hidrata form com viagem pendente que falhou na sync
  const [hidratando, setHidratando] = useState<boolean>(modoEdit);
  const [pendingOriginal, setPendingOriginal] = useState<PendingViagem | null>(null);

  useEffect(() => {
    if (!modoEdit) return;
    let alive = true;
    void (async () => {
      const list = await listPendingViagens();
      const item = list.find((x) => x.clientId === params.editarClientId);
      if (!alive) return;
      if (!item) {
        void showAlert({
          title: "Viagem não encontrada",
          message: "Essa viagem pode ter sido sincronizada ou excluída.",
          variant: "warning",
        }).then(() => router.back());
        return;
      }
      setPendingOriginal(item);
      const p = item.payload as Record<string, unknown>;
      // Trechos adicionais salvos (retorno do bota-fora). O campo de km guarda só
      // a IDA; o p.km salvo é o total (ida + trechos) — subtrai a soma dos trechos.
      const trechosSalvos = Array.isArray(p.trechos)
        ? (p.trechos as { tipo?: string; km?: number }[])
        : [];
      const kmTrechos = trechosSalvos.reduce(
        (s, t) => s + (typeof t.km === "number" ? t.km : 0),
        0,
      );
      const temBotaFora = trechosSalvos.some((t) => t.tipo === "RETORNO_BOTA_FORA");
      setForm({
        veiculoId: String(p.veiculoId ?? ""),
        clienteId: String(p.clienteId ?? ""),
        materialId: String(p.materialId ?? ""),
        data: typeof p.data === "string" ? p.data.slice(0, 10) : today(),
        toneladas: numToStr(p.toneladas),
        ticket: String(p.ticket ?? ""),
        km: numToStr(
          typeof p.km === "number" ? Math.max(0, p.km - kmTrechos) : p.km,
        ),
        localCargaId: String(p.localCargaId ?? ""),
        localDescargaId: String(p.localDescargaId ?? ""),
        valorPedagio: p.valorPedagioTotal != null ? numToStr(p.valorPedagioTotal) : "",
        observacao: String(p.observacao ?? ""),
      });
      // Preview da foto se motorista tinha capturado uma e ela ainda nao subiu.
      // Se ja tem fotoKey, a foto ja foi pro servidor — nao mostra preview local
      // (motorista pode trocar tirando foto nova se quiser).
      if (item.fotoUri && item.fotoMime) {
        setFoto({ uri: item.fotoUri, mime: item.fotoMime });
      }
      if (temBotaFora) setTeveBotaFora(true);
      // Modo edit nao deve disparar autopreencher KM via rota (motorista ja
      // tinha um valor explícito) — bloqueia o auto-fill marcando como manual.
      setKmEditadoManual(true);
      setHidratando(false);
    })();
    return () => {
      alive = false;
    };
  }, [modoEdit, params.editarClientId]);

  const rota = useCalcularRota(form.localCargaId, form.localDescargaId);
  const pedagiosNaRota = usePedagiosNaRota(form.localCargaId, form.localDescargaId);
  // Variantes COM retorno vs SEM retorno (curb). Se vierem 2, têm precedência
  // sobre as alternativas de estrada: o motorista confirma se voltou no retorno.
  const opcoesRetorno = useOpcoesRota(
    modoEdit ? undefined : form.localCargaId,
    modoEdit ? undefined : form.localDescargaId,
  );
  const usarRetorno = !modoEdit && (opcoesRetorno.data?.length ?? 0) >= 2;
  // Alternativas de estrada — só DEPOIS que /opcoes resolveu e não há retorno.
  // Sequenciar (em vez de disparar em paralelo) evita corrida entre as duas
  // fontes deixarem seleção velha, e mantém uma fonte única estável.
  const buscarAlternativas =
    !modoEdit && !usarRetorno && opcoesRetorno.isFetched;
  const alternativas = useRotasAlternativas(
    buscarAlternativas ? form.localCargaId : undefined,
    buscarAlternativas ? form.localDescargaId : undefined,
  );
  // Fonte ÚNICA que governa km/geometria (retorno vence estrada). Memoizado pra
  // referência estável (evita recomputar kmRecomendado / re-rodar o effect à toa).
  const rotasAtivas = useMemo(
    () => (usarRetorno ? opcoesRetorno.data! : alternativas.data ?? []),
    [usarRetorno, opcoesRetorno.data, alternativas.data],
  );
  // Mostra o mapa sempre que houver 1+ rota (informativo); seletor com 2+.
  const temMapa = !modoEdit && rotasAtivas.length >= 1;
  // km da recomendada — snapshot pra kmCalculado quando não há escolha ativa.
  const kmRecomendado = useMemo(() => {
    const rec = rotasAtivas.find((r) => r.recomendada);
    if (rec) return parseFloat(rec.km);
    // Só um km de rota REAL (OSRM/cache) conta como "calculado". O estimado por
    // haversine (sem rede, linha reta) NÃO vai como kmCalculado — assim o backend
    // sabe que precisa recalcular pelo trajeto certo quando a viagem sincronizar.
    return rota.data &&
      "km" in rota.data &&
      rota.data.km !== null &&
      rota.data.fonte !== "estimado_haversine"
      ? parseFloat(String(rota.data.km))
      : undefined;
  }, [rotasAtivas, rota.data]);

  // Referência de km do trajeto (o que a frota já rodou nesse par). Gateada pela
  // flag; devolve null offline sem cache (a sugestão só não aparece).
  const refKm = useReferenciaKm(form.localCargaId, form.localDescargaId);
  const sugestaoKm = useMemo(() => {
    const ref = refKm.data;
    // Só sugere com amostra suficiente (efetiva já resolvida como HISTORICO pelo
    // backend). Sem isso, cai no fluxo normal do OSRM.
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
  const kmAtualNum = parseFloat(form.km.replace(",", "."));
  // Não repete o óbvio: some quando o km já bate com a sugestão.
  const sugestaoJaAplicada =
    sugestaoKm != null &&
    Number.isFinite(kmAtualNum) &&
    Math.abs(kmAtualNum - sugestaoKm.km) < 0.5;
  const mostrarSugestao = sugestaoKm != null && !sugestaoJaAplicada;

  // Avaliação do km atual contra a referência (mesma fn pura do backend). null =
  // não dá pra avaliar (sem referência, config off, km curto).
  const avaliacao = useMemo(
    () => avaliarKm(kmAtualNum, refKm.data ?? null),
    [kmAtualNum, refKm.data],
  );
  const kmForaDoPadrao = avaliacao?.foraDoPadrao === true;

  // Trocar de par zera a procedência escolhida e a exigência de justificativa —
  // o km será re-decidido pro par novo.
  useEffect(() => {
    setKmFonte(null);
    setExigirJustificativa(false);
  }, [form.localCargaId, form.localDescargaId]);

  // Escolher rota/variante: seta km + geometria e SAI do modo manual (escolher
  // uma opção ≠ digitar na mão).
  function escolherRota(idx: number) {
    const r = rotasAtivas[idx];
    if (!r) return;
    tele.km({ modo: "rota", km: r.km, opcao: idx });
    setKmEditadoManual(false);
    setKmFonte("ROTA_ESCOLHIDA");
    setRotaIdx(idx);
    setRotaGeometriaEscolhida(r.geometria);
    setForm((f) => ({ ...f, km: r.km }));
  }

  // "Foi outro valor": entra no modo manual (o motorista digita o km no card).
  // Zera a variante escolhida; mantém o km atual como ponto de partida pra editar.
  function ativarManual() {
    tele.km({ modo: "manual" });
    setRotaIdx(-1);
    setRotaGeometriaEscolhida(null);
    setKmEditadoManual(true);
    setKmFonte("MANUAL");
  }

  // Aceitou a sugestão do histórico da frota: preenche o km e marca a
  // procedência HISTORICO (o backend não trata isso como "ajustou na mão").
  // Sai do governo da rota pra o auto-fill não brigar.
  function usarSugestaoKm(kmSugerido: number) {
    tele.km({ modo: "sugestao", km: formatKmInput(kmSugerido) });
    setRotaIdx(-1);
    setRotaGeometriaEscolhida(null);
    setKmEditadoManual(true);
    setKmFonte("HISTORICO");
    setForm((f) => ({ ...f, km: formatKmInput(kmSugerido) }));
  }

  // Enquanto o seletor governa o km, o auto-fill fica parado.
  const kmGovernadoPorRota = temMapa && rotaGeometriaEscolhida != null;

  // INVARIANTE anti-divergência: quando o seletor governa, kmCalculado = km da
  // opção ESCOLHIDA (não a recomendada fixa). Assim km == kmCalculado e nada
  // dispara auditoria/reprocessamento — nem se o motorista trocar de opção.
  const kmCalculadoFinal =
    kmGovernadoPorRota && rotasAtivas[rotaIdx]
      ? parseFloat(rotasAtivas[rotaIdx]!.km)
      : kmRecomendado;

  // Escolha "voltei no retorno" (true) vs "segui direto" (false) — só quando o
  // card de retorno foi mostrado (usarRetorno) e o motorista escolheu. Senão
  // undefined (não perguntado → backend grava null). O painel respeita no recalcular.
  const retornoConfirmado =
    usarRetorno && rotaGeometriaEscolhida != null
      ? rotasAtivas[rotaIdx]?.retorno
      : undefined;

  // Auto-preenche KM com valor calculado pelo OSRM, se motorista nao editou.
  // No card de RETORNO nunca auto-preenche: o km só vem da escolha consciente
  // (nenhuma opção vem marcada), senão o preguiçoso passaria batido.
  useEffect(() => {
    if (usarRetorno || kmEditadoManual || kmGovernadoPorRota) return;
    if (!rota.data || rota.data.km === null) return;
    const novoKm = rota.data.km;
    setForm((f) => (f.km === novoKm ? f : { ...f, km: novoKm }));
  }, [rota.data, kmEditadoManual, kmGovernadoPorRota, usarRetorno]);

  // Pré-seleciona a recomendada SÓ no seletor de estrada. No card de RETORNO
  // NENHUMA opção vem marcada — o motorista escolhe conscientemente (não empurra
  // pro km maior nem deixa o preguiçoso passar batido).
  useEffect(() => {
    if (usarRetorno) return;
    if (kmEditadoManual || rotaGeometriaEscolhida != null) return;
    if (rotasAtivas.length < 1) return;
    const recIdx = Math.max(0, rotasAtivas.findIndex((r) => r.recomendada));
    escolherRota(recIdx);
  }, [rotasAtivas, kmEditadoManual, rotaGeometriaEscolhida]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detecta local de carga/descarga a partir dos pontos GPS do tracking.
  // O GPS de LARGADA (e de chegada) costuma ser impreciso (cold start, prédios),
  // então olha os PRIMEIROS/ÚLTIMOS N pontos e pega o local mais próximo num raio
  // folgado — evita o falso "nenhum local por perto" quando na verdade tem.
  const matchesGps = useMemo(() => {
    if (!tracking || !cat.data) return null;

    const candidatosCarga = cat.data.locais.filter(
      (l) => l.tipo === "CARGA" || l.tipo === "AMBOS",
    );
    const candidatosDescarga = cat.data.locais.filter(
      (l) => l.tipo === "DESCARGA" || l.tipo === "AMBOS",
    );

    const N = 12;
    const RAIO_M = 350;
    const primeiros = tracking.pontos.slice(0, N);
    const ultimos = tracking.pontos.slice(-N);

    // Coordenada de CARGA capturada no início pela posição ao vivo (trava em
    // ~1-2s). Mais confiável que os primeiros pontos do tracking, que podem
    // faltar se o motorista finalizou logo após iniciar (parado na carga). É o
    // que conserta a corrida "cliquei em cheguei rápido e a carga não puxou".
    const cargaFix =
      params.cargaLat && params.cargaLng
        ? { lat: parseFloat(params.cargaLat), lng: parseFloat(params.cargaLng) }
        : null;
    const pontosCarga = cargaFix ? [cargaFix, ...primeiros] : primeiros;

    // Melhor match entre vários pontos daquela ponta da viagem.
    const melhor = (
      pontos: { lat: number; lng: number }[],
      candidatos: Local[],
    ): { local: Local; distanciaMetros: number } | null => {
      let best: { local: Local; distanciaMetros: number } | null = null;
      for (const p of pontos) {
        const m = localMaisProximo(p.lat, p.lng, candidatos, RAIO_M);
        if (m && (!best || m.distanciaMetros < best.distanciaMetros)) best = m;
      }
      return best;
    };

    return {
      carga: melhor(pontosCarga, candidatosCarga),
      descarga: melhor(ultimos, candidatosDescarga),
    };
  }, [tracking, cat.data, params.cargaLat, params.cargaLng]);

  // Aplica os matches no form (uma vez, depois deixa motorista editar)
  const [autoAplicado, setAutoAplicado] = useState(false);
  useEffect(() => {
    if (!matchesGps || autoAplicado) return;
    setAutoAplicado(true);
    setForm((f) => ({
      ...f,
      ...(matchesGps.carga && !f.localCargaId
        ? { localCargaId: matchesGps.carga.local.id }
        : {}),
      ...(matchesGps.descarga && !f.localDescargaId
        ? { localDescargaId: matchesGps.descarga.local.id }
        : {}),
    }));
  }, [matchesGps, autoAplicado]);

  useEffect(() => {
    let alive = true;
    void pegarCoordsPrecisa().then((res) => {
      if (alive && res.ok) setCoords(res.coords);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Pré-seleciona placa default
  useEffect(() => {
    if (me.data?.veiculoDefaultId && !form.veiculoId) {
      setForm((f) => ({ ...f, veiculoId: me.data!.veiculoDefaultId! }));
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const veiculoOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.veiculos ?? []).map((v) => ({
        value: v.id,
        label: v.placa,
        sublabel: v.modelo ?? undefined,
      })),
    [cat.data?.veiculos],
  );

  const clienteOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.clientes ?? []).map((o) => ({
        value: o.id,
        label: o.nome,
        sublabel: o.empresa.nome,
      })),
    [cat.data?.clientes],
  );

  const materialOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.materiais ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [cat.data?.materiais],
  );

  // Alguns materiais não exigem ticket (ex: concreto) — o admin configura isso.
  // Default true: se o catálogo é antigo (sem o campo) ou o material não foi
  // escolhido, mantém a exigência.
  const exigeTicket = useMemo(() => {
    const m = cat.data?.materiais.find((x) => x.id === form.materialId);
    return m?.exigeTicket ?? true;
  }, [cat.data?.materiais, form.materialId]);

  // Material libera "voltar pro bota-fora" (limpeza)? Só então mostra a pergunta.
  const permiteBotaFora = useMemo(() => {
    const m = cat.data?.materiais.find((x) => x.id === form.materialId);
    return m?.permiteBotaFora ?? false;
  }, [cat.data?.materiais, form.materialId]);
  const botaFora = permiteBotaFora && teveBotaFora;
  // Bota-fora: volta descarga→carga com as MESMAS variantes da ida (com/sem
  // retorno). Só busca quando marcado.
  const opcoesVolta = useOpcoesRota(
    botaFora ? form.localDescargaId : undefined,
    botaFora ? form.localCargaId : undefined,
  );
  // Casa a variante com a escolha da ida: só usa "com retorno" (curb) se o
  // motorista escolheu isso na ida; senão vai "direto". Ida e volta na mesma régua.
  const kmVolta = useMemo(() => {
    if (!botaFora) return null;
    const opts = opcoesVolta.data ?? [];
    if (opts.length === 0) return null;
    const alvo =
      retornoConfirmado === true
        ? opts.find((r) => r.retorno === true)
        : opts.find((r) => r.retorno === false);
    const escolhida = alvo ?? opts.find((r) => r.recomendada) ?? opts[0];
    return escolhida ? parseFloat(escolhida.km) : null;
  }, [botaFora, opcoesVolta.data, retornoConfirmado]);

  const nomeDescargaSelecionado = useMemo(() => {
    if (!form.localDescargaId) return undefined;
    const all = [...(cat.data?.locais ?? []), ...extraLocais];
    return all.find((l) => l.id === form.localDescargaId)?.nome;
  }, [form.localDescargaId, cat.data?.locais, extraLocais]);

  // Coordenadas do local de carga selecionado — passadas ao DescargaPorGps
  // pra detectar se o motorista está perto do carregamento ao tentar lançar
  // a descarga (caso clássico de engano).
  const localCargaCoords = useMemo(() => {
    if (!form.localCargaId) return null;
    const all = [...(cat.data?.locais ?? []), ...extraLocais];
    const l = all.find((x) => x.id === form.localCargaId);
    if (!l || l.lat == null || l.lng == null) return null;
    return { lat: l.lat, lng: l.lng, nome: l.nome };
  }, [form.localCargaId, cat.data?.locais, extraLocais]);

  const locaisFiltrados = useMemo(() => {
    if (!cat.data) return { carga: [] as SelectOption[] };
    const clienteId = form.clienteId || null;
    const todosIds = new Set(cat.data.locais.map((l) => l.id));
    const merged = [
      ...cat.data.locais,
      ...extraLocais.filter((l) => !todosIds.has(l.id)),
    ];
    const noCliente = merged.filter(
      (l) =>
        !clienteId || l.clienteIds.length === 0 || l.clienteIds.includes(clienteId),
    );

    // Calcula distância de cada local até a posição atual do motorista (se temos GPS).
    // Pra ordenar pelos mais próximos. Locais sem lat/lng vão pro fim.
    const distanciaDe = (l: (typeof noCliente)[number]): number => {
      if (!coords || l.lat == null || l.lng == null) return Infinity;
      return haversineMetros(coords.lat, coords.lng, l.lat, l.lng);
    };

    const opt = (l: (typeof noCliente)[number]): SelectOption => {
      const dist = distanciaDe(l);
      const sublabelBase = `${l.cidade}/${l.uf}`;
      const sublabel = Number.isFinite(dist)
        ? `${sublabelBase} · ${formatarDistancia(dist)}`
        : sublabelBase;
      return { value: l.id, label: l.nome, sublabel };
    };

    const ordenar = (arr: typeof noCliente) =>
      [...arr].sort((a, b) => distanciaDe(a) - distanciaDe(b));

    return {
      carga: ordenar(
        noCliente.filter((l) => l.tipo === "CARGA" || l.tipo === "AMBOS"),
      ).map(opt),
    };
  }, [cat.data, form.clienteId, extraLocais, coords]);

  function update<K extends keyof FormShape>(k: K, v: FormShape[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    // Edição manual remove marca de OCR — esse valor não é mais "da IA"
    setOcrCampos((s) => {
      if (!s.has(k as string)) return s;
      const next = new Set(s);
      next.delete(k as string);
      return next;
    });
  }

  /**
   * Preenche apenas campos vazios do form com as sugestões da IA. Não
   * sobrescreve nada que o motorista já digitou. Marca cada campo aplicado
   * em `ocrCampos` pra persistir no submit.
   */
  function aplicarSugestoesIa(s: ExtrairTicketResult) {
    const aplicados = new Set<string>();
    setForm((f) => {
      const next = { ...f };
      if (!next.ticket && s.ticket) {
        next.ticket = s.ticket.toUpperCase();
        aplicados.add("ticket");
      }
      if (!next.toneladas.trim() && typeof s.toneladas === "number") {
        next.toneladas = String(s.toneladas).replace(".", ",");
        aplicados.add("toneladas");
      }
      if (!next.km.trim() && typeof s.km === "number") {
        next.km = String(s.km).replace(".", ",");
        aplicados.add("km");
      }
      if (!next.clienteId && s.clienteId) {
        next.clienteId = s.clienteId;
        aplicados.add("clienteId");
      }
      if (!next.materialId && s.materialId) {
        next.materialId = s.materialId;
        aplicados.add("materialId");
      }
      if (!next.veiculoId && s.veiculoId) {
        next.veiculoId = s.veiculoId;
        aplicados.add("veiculoId");
      }
      // Data: só sobrescreve se motorista ainda tá no default de hoje
      if (s.data && next.data === today()) {
        next.data = s.data;
        aplicados.add("data");
      }
      return next;
    });
    setOcrCampos(aplicados);
    setOcrConfidence(s.confidence);
    if (aplicados.size > 0) {
      tele.ocr({ campos: [...aplicados], confianca: s.confidence ?? null });
    }
  }

  // Validação guiada: aponta o 1º campo que falta na ORDEM VISUAL da tela
  // (placa → data → cliente → material → toneladas → ticket → carga →
  // descarga → km), rolando até ele e destacando em vermelho.
  // Valida tudo que NÃO é peso/ticket (esses podem ficar pra depois, no modo
  // "aguardando peso"). Aponta o 1º campo que falta na ordem visual da tela.
  function validarBase(): boolean {
    if (!form.veiculoId) return void val.apontar("veiculoId", "Escolha a placa do caminhão"), false;
    if (!form.clienteId) return void val.apontar("clienteId", "Escolha o cliente"), false;
    if (!form.materialId) return void val.apontar("materialId", "Escolha o material"), false;
    if (!form.localCargaId) return void val.apontar("localCarga", "Escolha o local de carga"), false;
    if (!form.localDescargaId)
      return void val.apontar("localDescarga", "Marque o local de descarga"), false;
    // Card de retorno: exige escolha CONSCIENTE (voltou / não voltou / outro
    // valor). Sem isso o km podia vir pré-preenchido (stale de uma alternativa
    // de estrada) e o motorista caía direto no modal de confirmação sem ter
    // marcado nada. Aponta o card do km.
    if (usarRetorno && rotaGeometriaEscolhida == null && !kmEditadoManual)
      return (
        void val.apontar(
          "km",
          'Marque se voltou no retorno — ou toque em "Foi outro valor" e informe o km',
        ),
        false
      );
    if (!form.km.trim()) return void val.apontar("km", "Informe os km rodados"), false;
    // Observação obrigatória quando o motorista MEXEU no km calculado (digitou
    // outro valor ou tocou "Foi outro valor" → kmFonte=MANUAL) OU quando o km é
    // atípico e ele insistiu. Um lugar só pra justificar km — a observação.
    const kmMexido = kmFonte === "MANUAL";
    if ((kmMexido || exigirJustificativa) && form.observacao.trim().length < 5)
      return (
        void val.apontar(
          "observacao",
          kmMexido
            ? "Você mudou o km calculado. Explique aqui na observação por quê."
            : "Km fora do padrão do trajeto. Explique aqui na observação.",
        ),
        false
      );
    return true;
  }

  async function salvar() {
    setErro(null);

    // Primeiro valida TUDO que não é peso/ticket. Só quando o resto do form já
    // está completo é que o peso faltando vira a pergunta — nunca no meio do
    // preenchimento (senão o modal aparecia com campos ainda vazios embaixo).
    if (!validarBase()) return;

    // Se falta o peso, pode ser que o romaneio (peso + ticket) só saia no fim
    // do dia. Em vez de só bloquear, oferece lançar agora e completar depois.
    let aguardandoPeso = false;
    if (!form.toneladas.trim()) {
      const escolha = await showAlert({
        title: "Você já tem o peso?",
        message:
          "Se o peso e o romaneio (ticket) só saem no fim do dia, dá pra lançar a viagem agora e completar depois — a gente te lembra.",
        variant: "warning",
        buttons: [
          { label: "Tenho o peso agora", value: "tenho", style: "default" },
          { label: "O peso sai no fim do dia", value: "depois", style: "outline" },
        ],
      });
      if (escolha === "depois") {
        aguardandoPeso = true;
      } else {
        // "Tenho o peso agora" ou fechou: aponta o campo do peso e volta.
        return void val.apontar("toneladas", "Informe as toneladas");
      }
    }

    // Peso presente: valida a FAIXA já apontando o campo (antes ia só cair no
    // safeParse final e mostrar o erro genérico lá embaixo). Motorista leigo
    // costuma digitar em quilo/sem vírgula — a mensagem lembra que é tonelada.
    if (!aguardandoPeso) {
      const t = parseFloat(form.toneladas.replace(",", "."));
      if (!Number.isFinite(t) || t <= 0) {
        return void val.apontar(
          "toneladas",
          "Informe o peso em toneladas. Ex.: 27,5",
        );
      }
      // MAX_TONELADAS do schema (@ronan/shared-types) = 9999.
      if (t > 9999) {
        return void val.apontar(
          "toneladas",
          "Peso alto demais. É em TONELADAS, não em quilos — ex.: 27,5. Faltou a vírgula?",
        );
      }
    }

    // Peso presente e não é aguardando peso: ticket segue as regras normais.
    if (!aguardandoPeso && exigeTicket && !form.ticket.trim()) {
      return void val.apontar("ticket", "Informe o número do ticket");
    }

    // Km fora do padrão do trajeto: avisa uma vez; se insistir, exige a
    // explicação na observação (rede de segurança). Pula quando a observação já
    // está preenchida (motorista que digitou o km na mão já explicou lá — não
    // cobra duas vezes) ou no 2º passo (exigirJustificativa já ligado).
    if (
      kmForaDoPadrao &&
      avaliacao &&
      !exigirJustificativa &&
      form.observacao.trim().length < 5
    ) {
      const r = await showAlert({
        title: "Km fora do padrão",
        message: `As outras viagens desse trajeto deram ≈${formatKmInput(
          avaliacao.referencia,
        )} km. Você marcou ${form.km.replace(".", ",")} km.`,
        variant: "warning",
        buttons: [
          { label: "Rever o km", value: "rever", style: "cancel" },
          { label: "Está certo, seguir", value: "seguir", style: "outline" },
        ],
      });
      if (r !== "seguir") return void val.apontar("km", "Confira os km rodados");
      setExigirJustificativa(true);
      return void val.apontar(
        "observacao",
        "Explique aqui na observação por que o km ficou diferente",
      );
    }

    val.limpar();
    // Aviso quando a data não é hoje — caso o motorista tenha tocado sem
    // querer, dá chance de corrigir ou voltar pra hoje antes de salvar.
    let dataFinal = form.data;
    if (dataFinal !== hojeISO()) {
      const escolha = await showAlert({
        title: "Data diferente de hoje",
        message: `A viagem está marcada como ${fmtDataBR(dataFinal)}. Hoje é ${fmtDataBR(hojeISO())}. Tem certeza?`,
        variant: "warning",
        buttons: [
          { label: "Cancelar", value: "cancel", style: "cancel" },
          { label: "Marcar hoje", value: "today" },
          { label: "Confirmar", value: "ok" },
        ],
      });
      if (escolha === "cancel" || escolha === null) return;
      if (escolha === "today") {
        dataFinal = hojeISO();
        setForm((f) => ({ ...f, data: dataFinal }));
      }
    }
    // Aviso quando rota passa por pedágios cadastrados mas o motorista
    // deixou o valor em branco OU digitou R$ 0 — chance comum de esquecer
    // de lançar (0 é tão suspeito quanto vazio numa rota com pedágio).
    // Skip silencioso se a query ainda não respondeu ou veio vazia.
    const pedagioNum = parseFloat(form.valorPedagio.replace(",", "."));
    const semValorPedagio = !form.valorPedagio.trim() || !(pedagioNum > 0);
    if (semValorPedagio && (pedagiosNaRota.data?.length ?? 0) > 0) {
      const lista = pedagiosNaRota
        .data!.slice(0, 5)
        .map((p) => `• ${p.nome}`)
        .join("\n");
      // Quando offline e sem polyline real, calculamos via linha reta
      // (mais falso positivo). Mensagem diferente pra motorista saber.
      const aproximado = pedagiosNaRota.data!.some((p) => p.aproximado);
      const titulo = aproximado
        ? "Sem internet — provavelmente passa por pedágio"
        : "Sem valor de pedágio?";
      const message = aproximado
        ? `Sem internet pra confirmar, mas a rota geral passa perto de ${pedagiosNaRota.data!.length} pedágio(s):\n\n${lista}\n\nVocê não preencheu o valor. Quer voltar e preencher?`
        : `A rota passa por ${pedagiosNaRota.data!.length} pedágio(s) cadastrado(s):\n\n${lista}\n\nVocê não preencheu o valor. Quer voltar e preencher?`;
      const ok = await showConfirm({
        title: titulo,
        message,
        confirmLabel: "Voltar e preencher",
        cancelLabel: "Salvar mesmo assim",
      });
      if (ok) return;
    }
    // Confirmação final do km. Deixa claro que o cálculo é AUTOMÁTICO e que o valor
    // do motorista prevalece. SEM INTERNET (haversine OU cache do aparelho): avisa
    // em destaque (variant warning) que foi offline e será recalculado ao voltar.
    // Bota-fora: km faturável = ida (form.km) + volta. Sem marcar, colapsa na ida.
    const kmBaseNum = parseFloat(form.km.replace(",", ".")) || 0;
    const kmTotalNum = kmBaseNum + (kmVolta ?? 0);
    const fonteRota =
      rota.data && "fonte" in rota.data ? rota.data.fonte : null;
    const semNet = fonteRota === "estimado_haversine" || fonteRota === "cache_local";
    const msgKm =
      fonteRota === "estimado_haversine"
        ? "⚠️ Você está SEM INTERNET. Esse km é só uma ESTIMATIVA por linha reta — pode não bater com a estrada. Quando a internet voltar, o sistema recalcula pela rota certa. Se você já sabe quanto rodou, toque em Alterar e informe."
        : fonteRota === "cache_local"
          ? "⚠️ Você está SEM INTERNET. Esse km veio de um cálculo ANTERIOR dessa rota, salvo no aparelho (cache). Quando a internet voltar, o sistema confere pela rota certa. Se você já sabe quanto rodou, toque em Alterar e informe."
          : "Esse km foi calculado automático pela rota. Se você rodou diferente, toque em Alterar e corrija — o que você confirmar é o que vale.";
    // Km fora do padrão já passou pelo pop-up próprio (+ justificativa) acima —
    // não repete a confirmação genérica.
    const kmConfirmado = kmForaDoPadrao
      ? true
      : await showConfirm({
          title:
            botaFora && kmVolta != null
              ? `Você rodou ${kmTotalNum.toFixed(2).replace(".", ",")} km? (ida + volta)`
              : `Você rodou ${form.km.replace(".", ",")} km?`,
          message: msgKm,
          variant: semNet ? "warning" : "default",
          confirmLabel: "Sim, está certo",
          cancelLabel: "Alterar o km",
        });
    if (!kmConfirmado) {
      return void val.apontar("km", "Ajuste o km rodado aqui");
    }
    setSubmitting(true);
    try {
      // GPS: usa o que foi pre-aquecido na montagem da tela. Se ainda nao
      // tem, tenta pegar last-known (instantaneo) com cap de 2s — sem
      // bloquear o salvar.
      const c = coords ?? (await pegarCoordsRapido());

      // Em modo edit, preserva os dados imutáveis (clientId, tracking GPS,
      // fotoKey se foto não mudou) do payload original — só sobreescreve o
      // que o motorista pode editar manualmente.
      const orig = pendingOriginal?.payload as Record<string, unknown> | undefined;
      const fotoMudou =
        modoEdit && !!foto && foto.uri !== pendingOriginal?.fotoUri;
      const preservaFotoKey =
        modoEdit && !fotoMudou && typeof orig?.fotoKey === "string"
          ? { fotoKey: orig.fotoKey as string }
          : {};
      const preservaTracking =
        modoEdit && orig?.iniciadoEm
          ? {
              iniciadoEm: orig.iniciadoEm,
              kmReal: orig.kmReal,
              pontos: orig.pontos,
            }
          : tracking
          ? {
              iniciadoEm: tracking.iniciadoEm,
              kmReal: parseFloat(tracking.kmReal),
              // Aplica Douglas-Peucker (tolerância 3m) — remove pontos
              // redundantes (motorista parado em semáforo etc) sem afetar a
              // forma da rota. Reduz storage em ~5-10x sem perda perceptível.
              pontos: simplificarPontos(tracking.pontos),
            }
          : {};

      const payload = {
        clientId: viagemClientId,
        veiculoId: form.veiculoId,
        clienteId: form.clienteId,
        materialId: form.materialId,
        data: dataFinal,
        // Aguardando peso: lança sem toneladas/ticket (romaneio no fim do dia).
        // O backend cria a viagem em AGUARDANDO_PESO e o motorista completa depois.
        toneladas: aguardandoPeso ? undefined : parseFloat(form.toneladas.replace(",", ".")),
        // Material que não exige ticket vai sem ticket (undefined).
        ticket: aguardandoPeso ? undefined : exigeTicket ? form.ticket.trim() : undefined,
        ...(aguardandoPeso ? { aguardandoPeso: true } : {}),
        km: kmTotalNum,
        // Snapshot do km OSRM no momento do lançamento — captura mesmo que
        // motorista tenha sobrescrito. Null quando OSRM não respondeu. Quando o
        // seletor governa, é o km da opção escolhida (== form.km) → sem divergência.
        // Bota-fora: só manda kmCalculado (ida+volta) quando as DUAS pernas vieram
        // de rota real; senão fica undefined pro backend reprocessar.
        kmCalculado: botaFora
          ? kmCalculadoFinal != null && kmVolta != null
            ? kmCalculadoFinal + kmVolta
            : undefined
          : kmCalculadoFinal,
        retornoConfirmado,
        // Bota-fora = 1 trecho de retorno pro local de carga (a volta que ele fez).
        trechos:
          botaFora && kmVolta != null && form.localCargaId
            ? [{ tipo: "RETORNO_BOTA_FORA", localId: form.localCargaId, km: kmVolta }]
            : undefined,
        // Motorista digitou na mão? O reprocessamento no servidor respeita isso.
        kmEditadoManual,
        // Procedência do km. Explícita quando o motorista escolheu (rota, mão ou
        // sugestão); senão resolve por contexto. O backend usa isto pra NÃO
        // acusar "ajustou km" quando ele só aceitou o histórico da frota.
        kmFonte:
          kmFonte ??
          (kmEditadoManual
            ? "MANUAL"
            : kmGovernadoPorRota
              ? "ROTA_ESCOLHIDA"
              : "ROTA_OSRM"),
        // Rota escolhida no seletor de mapa (rota real no painel).
        rotaGeometria: rotaGeometriaEscolhida ?? undefined,
        localCargaId: form.localCargaId,
        localDescargaId: form.localDescargaId,
        // Snapshot pra auto-recovery: se o local foi excluido server-side
        // entre o lancamento offline e a sync, backend recria a partir destes
        // dados. Sem isso, sync falha com "Local nao encontrado".
        ...(() => {
          const locais = cat.data?.locais ?? [];
          const carga = locais.find((l) => l.id === form.localCargaId);
          const descarga = locais.find((l) => l.id === form.localDescargaId);
          const snap = (l: typeof carga) =>
            l && l.lat != null && l.lng != null
              ? { nome: l.nome, lat: l.lat, lng: l.lng }
              : undefined;
          return {
            localCargaDados: snap(carga),
            localDescargaDados: snap(descarga),
          };
        })(),
        valorPedagioTotal: form.valorPedagio
          ? parseFloat(form.valorPedagio.replace(",", "."))
          : undefined,
        observacao: form.observacao.trim() || undefined,
        criadoOfflineEm:
          (modoEdit && typeof orig?.criadoOfflineEm === "string"
            ? orig.criadoOfflineEm
            : new Date().toISOString()),
        ...(c ? { lat: c.lat, lng: c.lng } : {}),
        ...(descargaCaptura
          ? {
              descargaLat: descargaCaptura.lat,
              descargaLng: descargaCaptura.lng,
              ...(descargaCaptura.precisao != null
                ? { descargaPrecisao: descargaCaptura.precisao }
                : {}),
              descargaFonte: descargaCaptura.fonte,
              ...(descargaCaptura.raioUsadoM != null
                ? { descargaRaioUsadoM: descargaCaptura.raioUsadoM }
                : {}),
              ...(descargaCaptura.distanciaMetros != null
                ? { descargaDistanciaMetros: descargaCaptura.distanciaMetros }
                : {}),
              descargaBuscaOffline: descargaCaptura.buscaOffline,
            }
          : {}),
        ...(ocrCampos.size > 0
          ? {
              ocrCampos: Array.from(ocrCampos),
              ocrConfidence: ocrConfidence ?? undefined,
            }
          : {}),
        ...preservaFotoKey,
        ...preservaTracking,
      };

      // Validação local: roda o mesmo schema do servidor antes de enfileirar
      // pra evitar pendentes inválidos (ex: toneladas > 9999).
      const parsed = CriarViagemInput.safeParse(payload);
      if (!parsed.success) {
        setErro(humanizeZodError(parsed.error));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setSubmitting(false);
        return;
      }

      if (modoEdit) {
        const novaFoto = fotoMudou && foto ? { uri: foto.uri, mime: foto.mime } : undefined;
        const res = await atualizarViagemPendente({
          clientId: params.editarClientId!,
          payload,
          foto: novaFoto,
        });
        if (res.removed) {
          void showAlert({
            title: "Viagem já sincronizada",
            message:
              "Essa viagem foi enviada com sucesso enquanto você editava. Não precisa salvar de novo.",
          }).then(() => router.back());
          setSubmitting(false);
          return;
        }
      } else {
        await criar({
          payload,
          foto: foto ?? undefined,
        });
      }
      // Telemetria: registra estado da viagem no momento do salvar pra
      // investigação posterior no dashboard (fontes do KM, foto, OCR, GPS).
      void reportarEvento(
        "viagem_salva",
        {
          kmInformado: form.km,
          kmCalculado: rota.data && "km" in rota.data ? rota.data.km : null,
          kmFonte: rota.data && "fonte" in rota.data ? rota.data.fonte : null,
          kmEditadoManual,
          temFoto: !!foto,
          ocrCampos: Array.from(ocrCampos),
          temGps: !!coords,
          modoEdit,
        },
        { viagemClientId: payload.clientId },
      );
      // Limpa o tracking armazenado localmente — viagem ja salva
      if (tracking && !modoEdit) {
        const { clearViagemAndamento } = await import("@/lib/tracking-storage");
        await clearViagemAndamento();
        await clearNavDestino();
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      saindoDePropositoRef.current = true;
      router.back();
    } catch (err) {
      setErro(humanizeApiError(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }

  const saindoDePropositoRef = useRef(false);

  // Tem coisa que o motorista perde se sair agora? Ignora o que já nasce
  // preenchido (placa default e data de hoje) pra não pedir confirmação à toa.
  const temDadosPreenchidos =
    foto != null ||
    descargaCaptura != null ||
    [
      form.toneladas,
      form.ticket,
      form.km,
      form.valorPedagio,
      form.observacao,
      form.clienteId,
      form.materialId,
      form.localCargaId,
      form.localDescargaId,
    ].some((v) => v.trim() !== "");

  // Voltar (botão do header, back do Android ou gesto) descartava o lançamento
  // inteiro calado — foto do ticket, peso, tudo. Um toque errado e o motorista
  // refazia do zero. Sair pelo "Descartar viagem" sempre confirmou; o back não.
  const navigation = useNavigation();
  usePreventRemove(temDadosPreenchidos && !submitting, ({ data }) => {
    // Saída que o próprio código pediu (salvou, ou descartou pelo botão, que já
    // confirmou): passa direto. Ref, não state — precisa valer no mesmo tick do
    // router.back() que vem logo em seguida.
    if (saindoDePropositoRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    void (async () => {
      const ok = await showConfirm({
        title: "Sair sem lançar?",
        message: "O que você preencheu aqui vai ser perdido, inclusive a foto do ticket.",
        confirmLabel: "Sair e perder",
        cancelLabel: "Continuar preenchendo",
        destructive: true,
      });
      if (!ok) return;
      saindoDePropositoRef.current = true;
      navigation.dispatch(data.action);
    })();
  });

  // Descarta a viagem capturada por GPS (apaga pontos + destino salvos) sem
  // lançar. Só faz sentido no modo GPS (tracking).
  async function descartarViagem() {
    const ok = await showConfirm({
      title: "Descartar viagem?",
      message:
        "Os pontos GPS e os dados capturados serão apagados. Quer mesmo descartar?",
      confirmLabel: "Descartar",
      cancelLabel: "Não",
      destructive: true,
    });
    if (!ok) return;
    const { clearViagemAndamento } = await import("@/lib/tracking-storage");
    await clearViagemAndamento();
    await clearNavDestino();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    // Já confirmou aqui — não pede de novo no guard do voltar.
    saindoDePropositoRef.current = true;
    router.back();
  }

  // Duração do trajeto (só modo GPS): do início ao último ponto capturado.
  const trackingDuracaoMin =
    tracking && tracking.pontos.length > 0
      ? Math.max(
          0,
          (new Date(
            tracking.pontos[tracking.pontos.length - 1]!.capturadoEm,
          ).getTime() -
            new Date(tracking.iniciadoEm).getTime()) /
            60000,
        )
      : 0;

  // ---- Seções do formulário ----
  // Mesmos campos, mesma lógica/estado/validação — apenas COMPOSTOS em duas
  // ordens: fluxo normal/edição (idêntico ao de sempre) e o layout guiado do
  // modo GPS ("finalizar viagem"). Extrair em variáveis evita duplicar lógica.

  const secaoFoto = (
    <Field label="Foto do ticket" hint="opcional, mas ajuda na conferência">
      <PhotoCapture
        value={foto}
        onChange={(novaFoto) => {
          setFoto(novaFoto);
          setSugestoesIa(null);
          if (novaFoto && me.data?.podeUsarOcrTicket) {
            void (async () => {
              try {
                const fotoBase64 = await FileSystem.readAsStringAsync(
                  novaFoto.uri,
                  { encoding: "base64" },
                );
                const res = await extrairTicket.mutateAsync({
                  fotoBase64,
                  mime: novaFoto.mime,
                });
                if (res.confidence > 0.2) setSugestoesIa(res);
              } catch {
                // silencioso — motorista preenche manual
              }
            })();
          }
        }}
      />
      {extrairTicket.isPending && (
        <View className="mt-2 flex-row items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
          <ActivityIndicator size="small" color="#64748b" />
          <Text className="text-sm text-muted-foreground">
            Lendo dados do ticket...
          </Text>
        </View>
      )}
      {sugestoesIa && (
        <BannerSugestoesIa
          sugestoes={sugestoesIa}
          catalogos={cat.data ?? null}
          onUsar={() => {
            aplicarSugestoesIa(sugestoesIa);
            setSugestoesIa(null);
          }}
          onDispensar={() => setSugestoesIa(null)}
        />
      )}
    </Field>
  );

  const secaoPlaca = (
    <View
      className="gap-2"
      ref={val.refCampo("veiculoId")}
      onLayout={val.onLayoutCampo("veiculoId")}
    >
      <Label error={!!val.erroDe("veiculoId")}>Placa</Label>
      <Select
        value={form.veiculoId}
        onChange={(v) => {
          val.limpar();
          update("veiculoId", v);
        }}
        options={veiculoOptions}
        placeholder="Escolha a placa"
        searchable
        telemetria={tele}
        campoTelemetria="placa"
        error={!!val.erroDe("veiculoId")}
      />
      {val.erroDe("veiculoId") ? <ErroCampo msg={val.erroDe("veiculoId")!} /> : null}
    </View>
  );

  const secaoData = (
    <Field label="Data">
      <DateField
        value={form.data}
        onChange={(v) => {
          update("data", v);
          tele.campo("data", v);
        }}
        disabled={submitting}
      />
    </Field>
  );

  const secaoCliente = (
    <View
      className="gap-2"
      ref={val.refCampo("clienteId")}
      onLayout={val.onLayoutCampo("clienteId")}
    >
      <Label error={!!val.erroDe("clienteId")}>Cliente</Label>
      <Select
        value={form.clienteId}
        onChange={(v) => {
          val.limpar();
          update("clienteId", v);
        }}
        options={clienteOptions}
        placeholder="Escolha o cliente"
        searchable
        telemetria={tele}
        campoTelemetria="cliente"
        error={!!val.erroDe("clienteId")}
      />
      {val.erroDe("clienteId") ? <ErroCampo msg={val.erroDe("clienteId")!} /> : null}
    </View>
  );

  const secaoMaterial = (
    <View
      className="gap-2"
      ref={val.refCampo("materialId")}
      onLayout={val.onLayoutCampo("materialId")}
    >
      <Label error={!!val.erroDe("materialId")}>Material</Label>
      <Select
        value={form.materialId}
        onChange={(v) => {
          val.limpar();
          update("materialId", v);
        }}
        options={materialOptions}
        placeholder="Escolha o material"
        searchable
        telemetria={tele}
        campoTelemetria="material"
        error={!!val.erroDe("materialId")}
      />
      {val.erroDe("materialId") ? (
        <ErroCampo msg={val.erroDe("materialId")!} />
      ) : !exigeTicket && form.materialId ? (
        <Text className="text-xs text-muted-foreground">
          Esse material não exige ticket — pode lançar sem número.
        </Text>
      ) : null}
    </View>
  );

  const secaoPesoTicket = (
    <View
      ref={(n) => {
        // toneladas + ticket dividem a mesma row → mesmo nó pra medir
        val.refCampo("toneladas")(n);
        val.refCampo("ticket")(n);
      }}
      onLayout={(e) => {
        val.onLayoutCampo("toneladas")(e);
        val.onLayoutCampo("ticket")(e);
      }}
    >
      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <Label error={!!val.erroDe("toneladas")}>Toneladas</Label>
          <Input
            value={form.toneladas}
            onChangeText={(v) => {
              val.limpar();
              update("toneladas", v);
            }}
            onBlur={() => {
              if (form.toneladas.trim()) tele.campo("toneladas", form.toneladas);
            }}
            keyboardType="decimal-pad"
            placeholder="0,000"
            maxLength={8}
            error={!!val.erroDe("toneladas")}
          />
          <Text className="text-xs text-muted-foreground">
            Em toneladas (máx 9999)
          </Text>
        </View>
        {exigeTicket && (
          <View className="flex-1 gap-2">
            <Label error={!!val.erroDe("ticket")}>Ticket</Label>
            <Input
              value={form.ticket}
              onChangeText={(v) => {
                val.limpar();
                update("ticket", v.toUpperCase());
              }}
              onBlur={() => {
                if (form.ticket.trim()) tele.campo("ticket", form.ticket);
              }}
              placeholder="número"
              maxLength={50}
              autoCapitalize="characters"
              autoCorrect={false}
              error={!!val.erroDe("ticket")}
            />
          </View>
        )}
      </View>
      {val.erroDe("toneladas") ? <ErroCampo msg={val.erroDe("toneladas")!} /> : null}
      {val.erroDe("ticket") ? <ErroCampo msg={val.erroDe("ticket")!} /> : null}
      {!form.toneladas.trim() && !val.erroDe("toneladas") ? (
        <Text className="text-xs text-muted-foreground">
          Romaneio só sai no fim do dia? Toque em salvar que a gente pergunta — dá pra lançar sem o peso e completar depois.
        </Text>
      ) : null}
    </View>
  );

  const secaoCarga = (
    <View
      className="gap-2"
      ref={val.refCampo("localCarga")}
      onLayout={val.onLayoutCampo("localCarga")}
    >
      <Label error={!!val.erroDe("localCarga")}>Local de carga</Label>
      <Select
        value={form.localCargaId}
        onChange={(v) => {
          val.limpar();
          update("localCargaId", v);
          // Já escolheu carga E descarga? Leva o motorista até o card de km
          // (evita rolar na mão pra escolher a rota). Só no fluxo do menu.
          if (!tracking && v && form.localDescargaId) val.rolarAte("kmCard");
        }}
        options={locaisFiltrados.carga}
        placeholder="Escolha o local de carga"
        title="Local de carga"
        searchable
        telemetria={tele}
        campoTelemetria="carga"
        emptyMessage={
          <View className="mx-4 mt-8 gap-2 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
            <View className="flex-row items-center gap-2">
              <MapPinOff size={22} color="#d97706" />
              <Text className="flex-1 text-lg font-bold text-amber-900">
                Não achamos esse local de carga
              </Text>
            </View>
            <Text className="text-base leading-6 text-amber-800">
              Os locais de carga mudam conforme o{" "}
              <Text className="font-bold">cliente</Text> que você escolheu lá em
              cima. Se não aparece o que procura, volte e confira se o cliente
              certo está selecionado.
            </Text>
          </View>
        }
        error={!!val.erroDe("localCarga")}
      />
      {val.erroDe("localCarga") ? <ErroCampo msg={val.erroDe("localCarga")!} /> : null}
      {tracking && (
        <GpsHint
          match={matchesGps?.carga ?? null}
          selecionadoId={form.localCargaId}
        />
      )}
    </View>
  );

  const secaoDescarga = (
    <View
      className={
        val.erroDe("localDescarga")
          ? "rounded-2xl border-2 border-destructive bg-destructive/5 p-3"
          : undefined
      }
      ref={val.refCampo("localDescarga")}
      onLayout={val.onLayoutCampo("localDescarga")}
    >
      <DescargaPorGps
        clienteId={form.clienteId || null}
        value={form.localDescargaId}
        onChange={(v) => {
          val.limpar();
          update("localDescargaId", v);
          // Nova descarga = nova rota; zera a escolha (nada marcado).
          setRotaGeometriaEscolhida(null);
          setRotaIdx(-1);
          setKmEditadoManual(false);
          // Carga já escolhida? Leva até o card de km (sem rolar na mão).
          if (!tracking && v && form.localCargaId) val.rolarAte("kmCard");
        }}
        onCaptura={setDescargaCaptura}
        nomeSelecionadoFallback={nomeDescargaSelecionado}
        localCargaCoords={localCargaCoords}
        telemetria={tele}
      />
      {val.erroDe("localDescarga") ? (
        <ErroCampo msg={val.erroDe("localDescarga")!} />
      ) : null}
      {tracking && (
        <GpsHint
          match={matchesGps?.descarga ?? null}
          selecionadoId={form.localDescargaId}
        />
      )}
    </View>
  );

  // Sugestão do histórico da frota: aparece no TOPO da seção de km (é contexto
  // pra decisão abaixo, não reação a ela). Some quando o km já bate com ela.
  const secaoSugestaoKm =
    mostrarSugestao && sugestaoKm ? (
      <SugestaoKmHistorico
        km={sugestaoKm.km}
        amostra={sugestaoKm.amostra}
        min={sugestaoKm.min}
        max={sugestaoKm.max}
        offline={semSinal}
        onUsar={() => usarSugestaoKm(sugestaoKm.km)}
      />
    ) : null;

  const secaoSeletorRotas =
    temMapa && !usarRetorno ? (
      <SeletorRotas
        rotas={rotasAtivas}
        selecionadaIdx={rotaIdx}
        onSelecionar={escolherRota}
      />
    ) : null;

  // Banner informativo de km fora do padrão (a explicação é exigida na
  // observação, não aqui). Mostrado no card de km enquanto a observação não foi
  // preenchida — some quando o motorista já explicou.
  const bannerKmForaDoPadrao =
    kmForaDoPadrao && avaliacao && form.observacao.trim().length < 5 ? (
      <AvisoKmForaDoPadrao referencia={avaliacao.referencia} />
    ) : null;

  const secaoKm = usarRetorno ? (
    /* Card de retorno É o campo de km: escolhe uma variante OU informa
       o valor na 3ª opção. O campo "Km rodados" separado some. */
    <View
      className="gap-3"
      ref={val.refCampo("km")}
      onLayout={val.onLayoutCampo("km")}
    >
      <SeletorRetorno
        opcoes={rotasAtivas}
        selecionadaIdx={
          rotaGeometriaEscolhida != null && !kmEditadoManual ? rotaIdx : -1
        }
        manualAtivo={kmEditadoManual}
        onSelecionar={escolherRota}
        onManual={ativarManual}
        erro={val.erroDe("km")}
      >
        <Input
          value={form.km}
          onChangeText={(v) => {
            val.limpar();
            setKmEditadoManual(true);
            setKmFonte("MANUAL");
            update("km", v);
          }}
          keyboardType="decimal-pad"
          placeholder="0,00"
          maxLength={8}
          autoFocus
          error={!!val.erroDe("km")}
        />
      </SeletorRetorno>
      <View className="gap-2">
        <Label>Pedágio (R$)</Label>
        <Input
          value={form.valorPedagio}
          onChangeText={(v) => update("valorPedagio", v)}
          keyboardType="decimal-pad"
          placeholder="opcional"
          maxLength={10}
        />
      </View>
      {bannerKmForaDoPadrao}
    </View>
  ) : (
    <View ref={val.refCampo("km")} onLayout={val.onLayoutCampo("km")}>
      <View className="flex-row gap-3">
        <View className="flex-1 gap-2">
          <Label error={!!val.erroDe("km")}>Km rodados</Label>
          <Input
            value={form.km}
            onChangeText={(v) => {
              val.limpar();
              setKmEditadoManual(true);
              setKmFonte("MANUAL");
              update("km", v);
            }}
            keyboardType="decimal-pad"
            placeholder="0,00"
            maxLength={8}
            error={!!val.erroDe("km")}
          />
          <KmHint
            rota={rota.data ?? null}
            loading={rota.isFetching}
            editado={kmEditadoManual}
          />
        </View>
        <View className="flex-1 gap-2">
          <Label>Pedágio (R$)</Label>
          <Input
            value={form.valorPedagio}
            onChangeText={(v) => update("valorPedagio", v)}
            keyboardType="decimal-pad"
            placeholder="opcional"
            maxLength={10}
          />
        </View>
      </View>
      {/* Aviso SEM INTERNET em LINHA INTEIRA (haversine OU cache local). Some
          quando a sugestão do histórico está visível — ela absorve o recado de
          offline numa linha só, pra a tela não empilhar dois banners. */}
      {!mostrarSugestao &&
      rota.data &&
      "fonte" in rota.data &&
      (rota.data.fonte === "estimado_haversine" ||
        rota.data.fonte === "cache_local") &&
      rota.data.km !== null &&
      !kmEditadoManual ? (
        <AvisoKmEstimado km={rota.data.km} fonte={rota.data.fonte} />
      ) : null}
      {val.erroDe("km") ? <ErroCampo msg={val.erroDe("km")!} /> : null}
      {bannerKmForaDoPadrao}
    </View>
  );

  const secaoBotaFora = permiteBotaFora ? (
    <PerguntaBotaFora
      valor={teveBotaFora}
      onMudar={setTeveBotaFora}
      kmBase={parseFloat(form.km.replace(",", ".")) || 0}
      kmVolta={kmVolta}
      carregando={botaFora && opcoesVolta.isFetching}
    />
  ) : null;

  // Observação vira obrigatória quando o motorista mexeu no km (MANUAL) ou o km
  // é atípico e ele insistiu — é onde ele justifica a mudança.
  const obsObrigatoria = kmFonte === "MANUAL" || exigirJustificativa;
  const secaoObs = (
    <View
      className="gap-2"
      ref={val.refCampo("observacao")}
      onLayout={val.onLayoutCampo("observacao")}
    >
      <Label error={!!val.erroDe("observacao")}>
        Observação{" "}
        <Text className="text-sm font-normal text-muted-foreground">
          {obsObrigatoria ? "— explique a mudança do km" : "(opcional)"}
        </Text>
      </Label>
      <Input
        value={form.observacao}
        onChangeText={(v) => {
          val.limpar();
          update("observacao", v);
        }}
        onBlur={() => {
          if (form.observacao.trim()) tele.campo("observacao", form.observacao);
        }}
        placeholder={
          obsObrigatoria ? "Ex.: desvio por obra na rodovia" : "..."
        }
        maxLength={500}
        multiline
        error={!!val.erroDe("observacao")}
      />
      {val.erroDe("observacao") ? <ErroCampo msg={val.erroDe("observacao")!} /> : null}
    </View>
  );

  const secaoSalvar = (
    <Button size="lg" className="h-20" onPress={salvar} loading={submitting}>
      <Check size={24} color="white" />
      <Text className="text-xl font-bold text-primary-foreground">
        {submitting
          ? "Salvando..."
          : modoEdit
          ? "Salvar alterações"
          : "Salvar viagem"}
      </Text>
    </Button>
  );

  // Card "herói" do resumo da viagem capturada (só modo GPS).
  const heroTracking = tracking ? (
    <View className="rounded-2xl border-2 border-primary/30 bg-primary/10 p-5">
      <View className="flex-row items-center gap-2">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-success">
          <Check size={18} color="white" strokeWidth={3} />
        </View>
        <Text className="text-xs font-bold uppercase tracking-wider text-primary">
          Viagem capturada por GPS
        </Text>
      </View>
      <Text
        className="mt-2 text-4xl font-extrabold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {tracking!.kmReal} km
      </Text>
      <View className="mt-2 flex-row gap-8">
        <MiniStat label="tempo" value={fmtDuracaoMin(trackingDuracaoMin)} />
        <MiniStat label="pontos" value={String(tracking!.pontos.length)} />
      </View>
    </View>
  ) : null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader title={modoEdit ? "Editar viagem pendente" : "Nova viagem"} />

      {(hidratando || ((cat.isLoading || me.isLoading) && !cat.data && !me.data)) && (
        <View className="items-center py-8">
          <ActivityIndicator />
          <Text className="mt-2 text-sm text-muted-foreground">
            {hidratando ? "Carregando viagem..." : "Carregando dados..."}
          </Text>
        </View>
      )}

      {!cat.isLoading && !cat.data && (
        <SemCatalogo carregando={cat.isFetching} aoBaixar={() => void cat.refetch()} />
      )}

      {cat.data && !hidratando && (
        <KeyboardAvoidingView
          behavior="padding"
          className="flex-1"
        >
          <ScrollView
            ref={val.scrollRef}
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Wrapper com ref pra validação guiada medir a posição real dos
                campos (measureLayout relativo a este View) mesmo dentro de cards. */}
            <View ref={val.conteudoRef} style={{ gap: 16 }}>
            {tracking ? (
              /* MODO GPS ("finalizar viagem"): layout guiado — resumo no topo,
                 carga/descarga (auto-detectados) primeiro, depois o resto. */
              <>
                {heroTracking}
                <Secao
                  titulo="Carga e descarga"
                  hint="Detectadas pelo seu trajeto — confira ou troque."
                >
                  {secaoCarga}
                  {secaoDescarga}
                </Secao>
                <Secao titulo="Dados da viagem">
                  {secaoCliente}
                  {secaoMaterial}
                  {secaoPlaca}
                  {secaoData}
                  {secaoPesoTicket}
                  {secaoFoto}
                </Secao>
                <Secao titulo="Km rodado">
                  {secaoSugestaoKm}
                  {secaoSeletorRotas}
                  {secaoKm}
                  {secaoBotaFora}
                </Secao>
                <Secao titulo="Observação">{secaoObs}</Secao>
                {erro ? <ErroCampo msg={erro} /> : null}
                {secaoSalvar}
                <Button
                  variant="ghost"
                  onPress={descartarViagem}
                  disabled={submitting}
                >
                  <Trash2 size={16} color="#dc2626" />
                  <Text className="text-sm font-medium text-destructive">
                    Descartar viagem
                  </Text>
                </Button>
              </>
            ) : (
              /* Fluxo NORMAL / EDIÇÃO: mesma ordem de sempre (familiar pra quem
                 já usa), agora agrupada nos cards de seção — igual ao modo GPS. */
              <>
                <Secao titulo="Dados da viagem">
                  {secaoFoto}
                  {secaoPlaca}
                  {secaoData}
                  {secaoCliente}
                  {secaoMaterial}
                  {secaoPesoTicket}
                </Secao>
                <Secao titulo="Carga e descarga">
                  {secaoCarga}
                  {secaoDescarga}
                </Secao>
                <View ref={val.refCampo("kmCard")}>
                  <Secao titulo="Km rodado">
                    {secaoSugestaoKm}
                    {secaoSeletorRotas}
                    {secaoKm}
                    {secaoBotaFora}
                  </Secao>
                </View>
                <Secao titulo="Observação">{secaoObs}</Secao>
                {erro ? <ErroCampo msg={erro} /> : null}
                {secaoSalvar}
              </>
            )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

    </SafeAreaView>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <Label>{label}</Label>
      {children}
      {hint && <Text className="text-xs text-muted-foreground">{hint}</Text>}
    </View>
  );
}

// Cartão de seção do layout guiado (modo GPS) — agrupa campos com título e
// respiro, estilo app moderno (cara de banco). Só usado no fluxo "finalizar".
function Secao({
  titulo,
  hint,
  children,
}: {
  titulo: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      className="gap-4 rounded-2xl border border-border bg-card p-4"
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 1,
      }}
    >
      <View className="gap-0.5">
        <Text className="text-base font-bold text-foreground">{titulo}</Text>
        {hint ? (
          <Text className="text-xs text-muted-foreground">{hint}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

// Número compacto do card-herói (tempo/pontos).
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text
        className="text-lg font-bold text-foreground"
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

function fmtDuracaoMin(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return `${h}h${m.toString().padStart(2, "0")}`;
}

function GpsHint({
  match,
  selecionadoId,
}: {
  match: { local: { id: string; nome: string }; distanciaMetros: number } | null;
  selecionadoId: string;
}) {
  if (!match) {
    // Já tem um local escolhido (ex: descarga = destino que ele navegou)? Não
    // mostra o alarme — só quando o campo está MESMO vazio.
    if (selecionadoId) return null;
    return (
      <Text className="text-xs text-muted-foreground">
        Não achei um local cadastrado por perto pelo GPS. Selecione manualmente.
      </Text>
    );
  }
  if (selecionadoId === match.local.id) {
    return (
      <Text className="text-xs font-medium text-success">
        ✓ Detectado por GPS · {match.distanciaMetros} m de &quot;{match.local.nome}&quot;
      </Text>
    );
  }
  // Motorista trocou: mostra qual seria a sugestão original
  return (
    <Text className="text-xs text-muted-foreground">
      Sugestão GPS era &quot;{match.local.nome}&quot; ({match.distanciaMetros} m).
    </Text>
  );
}

function KmHint({
  rota,
  loading,
  editado,
}: {
  rota:
    | { km: string; duracaoSegundos: number | null; fonte: string }
    | { km: null; erro: string }
    | null;
  loading: boolean;
  editado: boolean;
}) {
  if (loading) {
    return (
      <Text className="text-xs text-muted-foreground">Calculando rota…</Text>
    );
  }
  if (!rota) return null;
  if (rota.km === null) {
    return <Text className="text-xs text-muted-foreground">{rota.erro}</Text>;
  }
  const minutos =
    rota.duracaoSegundos != null ? Math.round(rota.duracaoSegundos / 60) : null;
  if (editado) {
    return (
      <Text className="text-xs text-muted-foreground">
        Editado manualmente — auto-calculado: {rota.km} km
      </Text>
    );
  }
  if (rota.fonte === "estimado_haversine" || rota.fonte === "cache_local") {
    // Ambos são SEM INTERNET → o aviso grande âmbar é renderizado em linha
    // inteira (fora da coluna estreita). Aqui, nada — pra não parecer "ok verde".
    return null;
  }
  return (
    <Text className="text-xs font-medium text-success">
      ✓ Calculado automaticamente ({rota.km} km
      {minutos != null ? ` · ${minutos} min` : ""})
    </Text>
  );
}

// Catalogos pode ser null enquanto carrega; recebe whatever vier de useCatalogos
type CatalogosShape = {
  clientes?: { id: string; nome: string }[];
  materiais?: { id: string; nome: string }[];
  veiculos?: { id: string; placa: string }[];
} | null;

function BannerSugestoesIa({
  sugestoes,
  catalogos,
  onUsar,
  onDispensar,
}: {
  sugestoes: ExtrairTicketResult;
  catalogos: CatalogosShape;
  onUsar: () => void;
  onDispensar: () => void;
}) {
  const linhas: string[] = [];
  if (sugestoes.ticket) linhas.push(`Ticket: ${sugestoes.ticket}`);
  if (sugestoes.toneladas != null)
    linhas.push(`Toneladas: ${sugestoes.toneladas.toString().replace(".", ",")}`);
  if (sugestoes.km != null) linhas.push(`Km: ${sugestoes.km.toString().replace(".", ",")}`);
  if (sugestoes.clienteId) {
    const c = catalogos?.clientes?.find((x) => x.id === sugestoes.clienteId);
    if (c) linhas.push(`Cliente: ${c.nome}`);
  } else if (sugestoes.clienteSugerido) {
    linhas.push(`Cliente lido: ${sugestoes.clienteSugerido} (sem match no cadastro)`);
  }
  if (sugestoes.materialId) {
    const m = catalogos?.materiais?.find((x) => x.id === sugestoes.materialId);
    if (m) linhas.push(`Material: ${m.nome}`);
  } else if (sugestoes.materialSugerido) {
    linhas.push(`Material lido: ${sugestoes.materialSugerido} (sem match no cadastro)`);
  }
  if (sugestoes.veiculoId) {
    const v = catalogos?.veiculos?.find((x) => x.id === sugestoes.veiculoId);
    if (v) linhas.push(`Placa: ${v.placa}`);
  } else if (sugestoes.placaSugerida) {
    linhas.push(`Placa lida: ${sugestoes.placaSugerida} (sem match no cadastro)`);
  }
  if (sugestoes.data) linhas.push(`Data: ${sugestoes.data}`);

  const temAlgo = linhas.length > 0;

  return (
    <View className="mt-2 rounded-md border border-blue-300 bg-blue-50 p-3">
      <Text className="text-sm font-semibold text-blue-900">
        {temAlgo ? "✨ IA leu do ticket:" : "✨ IA analisou a foto"}
      </Text>
      {temAlgo ? (
        linhas.map((l) => (
          <Text key={l} className="mt-0.5 text-sm text-blue-900">
            • {l}
          </Text>
        ))
      ) : (
        <Text className="mt-1 text-sm text-blue-900">
          Não consegui ler dados claros. Preencha manualmente.
        </Text>
      )}
      {sugestoes.observacoes && (
        <Text className="mt-1 text-xs italic text-blue-800">
          {sugestoes.observacoes}
        </Text>
      )}
      <View className="mt-3 flex-row gap-2">
        {temAlgo && (
          <Button onPress={onUsar} className="flex-1">
            <Check size={18} color="#fff" />
            <Text className="text-sm font-bold text-primary-foreground">
              Usar sugestões
            </Text>
          </Button>
        )}
        <Button variant="outline" onPress={onDispensar} className="flex-1">
          <X size={18} color="#0f172a" />
          <Text className="text-sm font-medium text-foreground">Dispensar</Text>
        </Button>
      </View>
    </View>
  );
}

// UUID v4 simples sem dependência (crypto.randomUUID nem sempre tá em RN)
function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

