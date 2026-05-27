import { useEffect, useMemo, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { DescargaPorGps } from "@/components/descarga-por-gps";
import { humanizeApiError } from "@/lib/api";
import { humanizeZodError } from "@/lib/validation";
import { CriarViagemInput } from "@ronan/shared-types";
import { formatarDistancia, haversineMetros, localMaisProximo, pegarCoords, pegarCoordsRapido } from "@/lib/geo";
import { simplificarPontos } from "@/lib/polyline";
import { listPendingViagens, type PendingViagem } from "@/db/database";
import * as FileSystem from "expo-file-system";
import type { ExtrairTicketResult } from "@ronan/shared-types";
import { atualizarViagemPendente } from "@/lib/sync";
import {
  useCalcularRota,
  useCatalogos,
  useCriarViagem,
  useExtrairTicket,
  useMe,
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

const today = () => new Date().toISOString().slice(0, 10);

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
  const extrairTicket = useExtrairTicket();
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Locais criados nesta sessão — merged no Select pra garantir que aparecem
  // mesmo se o cache do TanStack Query ainda não propagou
  const [extraLocais, setExtraLocais] = useState<Local[]>([]);
  // GPS pré-aquecido em background — modulo carrega + permissao + fix
  // enquanto motorista preenche o form. Quando toca Salvar, usa o que ja tem.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Rastreia se motorista editou KM manualmente — se sim, parou de auto-preencher
  const [kmEditadoManual, setKmEditadoManual] = useState(false);

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
        Alert.alert(
          "Viagem não encontrada",
          "Essa viagem pode ter sido sincronizada ou excluída.",
          [{ text: "OK", onPress: () => router.back() }],
        );
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

  // Auto-preenche KM com valor calculado pelo OSRM, se motorista nao editou
  useEffect(() => {
    if (kmEditadoManual) return;
    if (!rota.data || rota.data.km === null) return;
    const novoKm = rota.data.km;
    setForm((f) => (f.km === novoKm ? f : { ...f, km: novoKm }));
  }, [rota.data, kmEditadoManual]);

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
    void pegarCoords().then((c) => {
      if (alive && c) setCoords(c);
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
  }

  /**
   * Preenche apenas campos vazios do form com as sugestões da IA.
   * Não sobrescreve nada que o motorista já digitou.
   */
  function aplicarSugestoesIa(s: ExtrairTicketResult) {
    setForm((f) => {
      const next = { ...f };
      if (!next.ticket && s.ticket) next.ticket = s.ticket.toUpperCase();
      if (!next.toneladas.trim() && typeof s.toneladas === "number") {
        next.toneladas = String(s.toneladas).replace(".", ",");
      }
      if (!next.km.trim() && typeof s.km === "number") {
        next.km = String(s.km).replace(".", ",");
      }
      if (!next.clienteId && s.clienteId) next.clienteId = s.clienteId;
      if (!next.materialId && s.materialId) next.materialId = s.materialId;
      if (!next.veiculoId && s.veiculoId) next.veiculoId = s.veiculoId;
      // Data: só sobrescreve se motorista ainda tá no default de hoje
      if (s.data && next.data === today()) next.data = s.data;
      return next;
    });
  }

  function validar(): string | null {
    if (!form.veiculoId) return "Escolha a placa.";
    if (!form.clienteId) return "Escolha o cliente.";
    if (!form.materialId) return "Escolha o material.";
    if (!form.localCargaId) return "Escolha o local de carga.";
    if (!form.localDescargaId) return "Aperte 'Estou no local de descarga' ou escolha da lista.";
    if (!form.toneladas.trim()) return "Informe as toneladas.";
    if (!form.ticket.trim()) return "Informe o ticket.";
    if (!form.km.trim()) return "Informe os km rodados.";
    return null;
  }

  async function salvar() {
    setErro(null);
    const v = validar();
    if (v) {
      setErro(v);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
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
        data: form.data,
        toneladas: parseFloat(form.toneladas.replace(",", ".")),
        ticket: form.ticket.trim(),
        km: parseFloat(form.km.replace(",", ".")),
        // Snapshot do km OSRM no momento do lançamento — captura mesmo que
        // motorista tenha sobrescrito. Null quando OSRM não respondeu.
        kmCalculado:
          rota.data && "km" in rota.data && rota.data.km !== null
            ? parseFloat(String(rota.data.km))
            : undefined,
        localCargaId: form.localCargaId,
        localDescargaId: form.localDescargaId,
        valorPedagioTotal: form.valorPedagio
          ? parseFloat(form.valorPedagio.replace(",", "."))
          : undefined,
        observacao: form.observacao.trim() || undefined,
        criadoOfflineEm:
          (modoEdit && typeof orig?.criadoOfflineEm === "string"
            ? orig.criadoOfflineEm
            : new Date().toISOString()),
        ...(c ? { lat: c.lat, lng: c.lng } : {}),
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
          Alert.alert(
            "Viagem já sincronizada",
            "Essa viagem foi enviada com sucesso enquanto você editava. Não precisa salvar de novo.",
            [{ text: "OK", onPress: () => router.back() }],
          );
          setSubmitting(false);
          return;
        }
      } else {
        await criar({
          payload,
          foto: foto ?? undefined,
        });
      }
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
        <View className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <Text className="font-medium text-amber-900">Sem dados de catálogo</Text>
          <Text className="mt-1 text-sm text-amber-800">
            Conecte na internet uma vez pra carregar veículos, clientes, materiais e locais.
          </Text>
        </View>
      )}

      {cat.data && !hidratando && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
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
                        // Confidence muito baixo: provavelmente lixo, não mostra
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

            <Field label="Placa">
              <Select
                value={form.veiculoId}
                onChange={(v) => update("veiculoId", v)}
                options={veiculoOptions}
                placeholder="Escolha a placa"
                searchable
              />
            </Field>

            <Field label="Data">
              <DateField
                value={form.data}
                onChange={(v) => update("data", v)}
                disabled={submitting}
              />
            </Field>

            <Field label="Cliente">
              <Select
                value={form.clienteId}
                onChange={(v) => update("clienteId", v)}
                options={clienteOptions}
                placeholder="Escolha o cliente"
                searchable
              />
            </Field>

            <Field label="Material">
              <Select
                value={form.materialId}
                onChange={(v) => update("materialId", v)}
                options={materialOptions}
                placeholder="Escolha o material"
                searchable
              />
            </Field>

            <View className="flex-row gap-3">
              <View className="flex-1 gap-2">
                <Label>Toneladas</Label>
                <Input
                  value={form.toneladas}
                  onChangeText={(v) => update("toneladas", v)}
                  keyboardType="decimal-pad"
                  placeholder="0,000"
                  maxLength={8}
                />
                <Text className="text-xs text-muted-foreground">
                  Em toneladas (máx 9999)
                </Text>
              </View>
              <View className="flex-1 gap-2">
                <Label>Ticket</Label>
                <Input
                  value={form.ticket}
                  onChangeText={(v) => update("ticket", v.toUpperCase())}
                  placeholder="número"
                  maxLength={50}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
            </View>

            <Field label="Local de carga">
              <Select
                value={form.localCargaId}
                onChange={(v) => update("localCargaId", v)}
                options={locaisFiltrados.carga}
                placeholder="Escolha o local"
                searchable
                emptyMessage="Nenhum local de carga pra esse cliente"
              />
              {tracking && (
                <GpsHint
                  match={matchesGps?.carga ?? null}
                  selecionadoId={form.localCargaId}
                />
              )}
            </Field>

            <DescargaPorGps
              clienteId={form.clienteId || null}
              value={form.localDescargaId}
              onChange={(v) => update("localDescargaId", v)}
              nomeSelecionadoFallback={nomeDescargaSelecionado}
              localCargaCoords={localCargaCoords}
            />
            {tracking && (
              <GpsHint
                match={matchesGps?.descarga ?? null}
                selecionadoId={form.localDescargaId}
              />
            )}

            <View className="flex-row gap-3">
              <View className="flex-1 gap-2">
                <Label>Km rodados</Label>
                <Input
                  value={form.km}
                  onChangeText={(v) => {
                    setKmEditadoManual(true);
                    update("km", v);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  maxLength={8}
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

            <Field label="Observação" hint="opcional">
              <Input
                value={form.observacao}
                onChangeText={(v) => update("observacao", v)}
                placeholder="..."
                maxLength={500}
              />
            </Field>

            {erro && <Text className="text-sm text-destructive">{erro}</Text>}

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
  rota: { km: string; duracaoSegundos: number; fonte: string } | { km: null; erro: string } | null;
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
  const minutos = Math.round(rota.duracaoSegundos / 60);
  if (editado) {
    return (
      <Text className="text-xs text-muted-foreground">
        Editado manualmente — auto-calculado: {rota.km} km
      </Text>
    );
  }
  return (
    <Text className="text-xs font-medium text-success">
      ✓ Calculado automaticamente ({rota.km} km · {minutos} min)
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

