import { useEffect, useMemo, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
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
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { SemCatalogo } from "@/components/sem-catalogo";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { AvisoKmEstimado } from "@/components/aviso-km-estimado";
import { DescargaPorGps, type DescargaCaptura } from "@/components/descarga-por-gps";
import { SeletorRotas } from "@/components/seletor-rotas";
import { showAlert, showConfirm } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { fmtDataBR, hojeISO } from "@/lib/datetime";
import { reportarEvento } from "@/lib/event-reporter";
import { humanizeZodError } from "@/lib/validation";
import { CriarViagemInput } from "@ronan/shared-types";
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
  useRotasAlternativas,
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
    tracking ? { ...empty, km: tracking.kmReal } : empty,
  );
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
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
      setForm({
        veiculoId: String(p.veiculoId ?? ""),
        clienteId: String(p.clienteId ?? ""),
        materialId: String(p.materialId ?? ""),
        data: typeof p.data === "string" ? p.data.slice(0, 10) : today(),
        toneladas: numToStr(p.toneladas),
        ticket: String(p.ticket ?? ""),
        km: numToStr(p.km),
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
  // Rotas alternativas pro seletor de mapa (online-only; [] offline). Em modo
  // edit não faz sentido — o motorista já tinha um km explícito.
  const alternativas = useRotasAlternativas(
    modoEdit ? undefined : form.localCargaId,
    modoEdit ? undefined : form.localDescargaId,
  );
  // Mostra o mapa sempre que houver 1+ rota (informativo); seletor com 2+.
  const temMapa = !modoEdit && (alternativas.data?.length ?? 0) >= 1;
  // km da recomendada (routes[0]) — snapshot pra kmCalculado.
  const kmRecomendado = useMemo(() => {
    const rec = alternativas.data?.find((r) => r.recomendada);
    if (rec) return parseFloat(rec.km);
    return rota.data && "km" in rota.data && rota.data.km !== null
      ? parseFloat(String(rota.data.km))
      : undefined;
  }, [alternativas.data, rota.data]);

  // Escolher rota: seta km + guarda a geometria escolhida. NÃO marca edição
  // manual (escolher rota ≠ digitar km na mão).
  function escolherRota(idx: number) {
    const r = alternativas.data?.[idx];
    if (!r) return;
    setRotaIdx(idx);
    setRotaGeometriaEscolhida(r.geometria);
    setForm((f) => ({ ...f, km: r.km }));
  }

  // Enquanto o seletor governa o km, o auto-fill fica parado.
  const kmGovernadoPorRota = temMapa && rotaGeometriaEscolhida != null;

  // Auto-preenche KM com valor calculado pelo OSRM, se motorista nao editou
  useEffect(() => {
    if (kmEditadoManual || kmGovernadoPorRota) return;
    if (!rota.data || rota.data.km === null) return;
    const novoKm = rota.data.km;
    setForm((f) => (f.km === novoKm ? f : { ...f, km: novoKm }));
  }, [rota.data, kmEditadoManual, kmGovernadoPorRota]);

  // Pré-seleciona a recomendada quando chegam as alternativas (1+).
  useEffect(() => {
    if (kmEditadoManual || rotaGeometriaEscolhida != null) return;
    const alts = alternativas.data;
    if (!alts || alts.length < 1) return;
    const recIdx = Math.max(0, alts.findIndex((r) => r.recomendada));
    escolherRota(recIdx);
  }, [alternativas.data, kmEditadoManual, rotaGeometriaEscolhida]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detecta local de carga/descarga a partir dos pontos GPS do tracking.
  // Procura local cadastrado dentro de 200m do primeiro/último ponto.
  const matchesGps = useMemo(() => {
    if (!tracking || !cat.data || tracking.pontos.length < 2) return null;
    const primeiro = tracking.pontos[0];
    const ultimo = tracking.pontos[tracking.pontos.length - 1];
    if (!primeiro || !ultimo) return null;

    const candidatosCarga = cat.data.locais.filter(
      (l) => l.tipo === "CARGA" || l.tipo === "AMBOS",
    );
    const candidatosDescarga = cat.data.locais.filter(
      (l) => l.tipo === "DESCARGA" || l.tipo === "AMBOS",
    );

    return {
      carga: localMaisProximo(primeiro.lat, primeiro.lng, candidatosCarga, 200),
      descarga: localMaisProximo(ultimo.lat, ultimo.lng, candidatosDescarga, 200),
    };
  }, [tracking, cat.data]);

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
  }

  // Validação guiada: aponta o 1º campo que falta na ORDEM VISUAL da tela
  // (placa → data → cliente → material → toneladas → ticket → carga →
  // descarga → km), rolando até ele e destacando em vermelho.
  function validar(): boolean {
    if (!form.veiculoId) return void val.apontar("veiculoId", "Escolha a placa do caminhão"), false;
    if (!form.clienteId) return void val.apontar("clienteId", "Escolha o cliente"), false;
    if (!form.materialId) return void val.apontar("materialId", "Escolha o material"), false;
    if (!form.toneladas.trim()) return void val.apontar("toneladas", "Informe as toneladas"), false;
    if (exigeTicket && !form.ticket.trim())
      return void val.apontar("ticket", "Informe o número do ticket"), false;
    if (!form.localCargaId) return void val.apontar("localCarga", "Escolha o local de carga"), false;
    if (!form.localDescargaId)
      return void val.apontar("localDescarga", "Marque o local de descarga"), false;
    if (!form.km.trim()) return void val.apontar("km", "Informe os km rodados"), false;
    return true;
  }

  async function salvar() {
    setErro(null);
    if (!validar()) return;
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
    // deixou o valor em branco — chance comum de esquecer de lançar.
    // Skip silencioso se a query ainda não respondeu ou veio vazia.
    if (!form.valorPedagio.trim() && (pedagiosNaRota.data?.length ?? 0) > 0) {
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
        clientId: modoEdit ? params.editarClientId! : makeUuid(),
        veiculoId: form.veiculoId,
        clienteId: form.clienteId,
        materialId: form.materialId,
        data: dataFinal,
        toneladas: parseFloat(form.toneladas.replace(",", ".")),
        // Material que não exige ticket vai sem ticket (undefined).
        ticket: exigeTicket ? form.ticket.trim() : undefined,
        km: parseFloat(form.km.replace(",", ".")),
        // Snapshot do km OSRM no momento do lançamento — captura mesmo que
        // motorista tenha sobrescrito. Null quando OSRM não respondeu.
        kmCalculado: kmRecomendado,
        // Motorista digitou na mão? O reprocessamento no servidor respeita isso.
        kmEditadoManual,
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
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      setErro(humanizeApiError(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }

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
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            ref={val.scrollRef}
            contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {tracking && (
              <View className="flex-row items-center gap-3 rounded-2xl border-2 border-success/40 bg-success/15 p-4">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-success">
                  <Check size={20} color="white" strokeWidth={3} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-foreground">
                    Trajeto capturado por GPS
                  </Text>
                  <Text
                    className="text-sm text-muted-foreground"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {tracking.kmReal} km · {tracking.pontos.length} pontos
                  </Text>
                </View>
              </View>
            )}

            <Field label="Foto do ticket" hint="opcional, mas ajuda na conferência">
              <PhotoCapture
                value={foto}
                onChange={(novaFoto) => {
                  setFoto(novaFoto);
                  setSugestoesIa(null);
                  // OCR só quando há foto nova E motorista tem permissão.
                  // Best-effort: erro silencioso (sem internet, sem IA etc).
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

            <View className="gap-2" onLayout={val.onLayoutCampo("veiculoId")}>
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
                error={!!val.erroDe("veiculoId")}
              />
              {val.erroDe("veiculoId") ? <ErroCampo msg={val.erroDe("veiculoId")!} /> : null}
            </View>

            <Field label="Data">
              <DateField
                value={form.data}
                onChange={(v) => update("data", v)}
                disabled={submitting}
              />
            </Field>

            <View className="gap-2" onLayout={val.onLayoutCampo("clienteId")}>
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
                error={!!val.erroDe("clienteId")}
              />
              {val.erroDe("clienteId") ? <ErroCampo msg={val.erroDe("clienteId")!} /> : null}
            </View>

            <View className="gap-2" onLayout={val.onLayoutCampo("materialId")}>
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

            <View
              onLayout={(e) => {
                // toneladas + ticket dividem a mesma row → mesma posição de scroll
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
            </View>

            <View className="gap-2" onLayout={val.onLayoutCampo("localCarga")}>
              <Label error={!!val.erroDe("localCarga")}>Local de carga</Label>
              <Select
                value={form.localCargaId}
                onChange={(v) => {
                  val.limpar();
                  update("localCargaId", v);
                }}
                options={locaisFiltrados.carga}
                placeholder="Escolha o local"
                searchable
                emptyMessage="Nenhum local de carga pra esse cliente"
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

            <View
              className={
                val.erroDe("localDescarga")
                  ? "rounded-2xl border-2 border-destructive bg-destructive/5 p-3"
                  : undefined
              }
              onLayout={val.onLayoutCampo("localDescarga")}
            >
              <DescargaPorGps
                clienteId={form.clienteId || null}
                value={form.localDescargaId}
                onChange={(v) => {
                  val.limpar();
                  update("localDescargaId", v);
                  // Nova descarga = nova rota; reseta a escolha pra re-defaultar.
                  setRotaGeometriaEscolhida(null);
                  setRotaIdx(0);
                }}
                onCaptura={setDescargaCaptura}
                nomeSelecionadoFallback={nomeDescargaSelecionado}
                localCargaCoords={localCargaCoords}
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

            {temMapa ? (
              <SeletorRotas
                rotas={alternativas.data!}
                selecionadaIdx={rotaIdx}
                onSelecionar={escolherRota}
              />
            ) : null}

            <View onLayout={val.onLayoutCampo("km")}>
              <View className="flex-row gap-3">
                <View className="flex-1 gap-2">
                  <Label error={!!val.erroDe("km")}>Km rodados</Label>
                  <Input
                    value={form.km}
                    onChangeText={(v) => {
                      val.limpar();
                      setKmEditadoManual(true);
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
              {val.erroDe("km") ? <ErroCampo msg={val.erroDe("km")!} /> : null}
            </View>

            <Field label="Observação" hint="opcional">
              <Input
                value={form.observacao}
                onChangeText={(v) => update("observacao", v)}
                placeholder="..."
                maxLength={500}
              />
            </Field>

            {erro ? <ErroCampo msg={erro} /> : null}

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

function GpsHint({
  match,
  selecionadoId,
}: {
  match: { local: { id: string; nome: string }; distanciaMetros: number } | null;
  selecionadoId: string;
}) {
  if (!match) {
    return (
      <Text className="text-xs text-muted-foreground">
        Nenhum local cadastrado num raio de 200 m do ponto GPS. Selecione
        manualmente.
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
  if (rota.fonte === "estimado_haversine") {
    return <AvisoKmEstimado km={rota.km} />;
  }
  if (rota.fonte === "cache_local") {
    return (
      <Text className="text-xs font-medium text-success">
        ✓ Estimado de cálculo anterior ({rota.km} km)
      </Text>
    );
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
            <Text className="text-sm font-bold text-primary-foreground">
              Usar sugestões
            </Text>
          </Button>
        )}
        <Button variant="outline" onPress={onDispensar} className="flex-1">
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

