import { useCallback, useMemo, useState } from "react";
import { router, Stack, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Flag,
  MapPin,
  Trash2,
  User,
} from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TipoEventoViagem } from "@ronan/shared-types";
import { ScreenHeader } from "@/components/screen-header";
import { LocalPorGps, type SelecaoLocal } from "@/components/local-por-gps";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showConfirm } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import type { FonteGps } from "@ronan/shared-types";
import { mensagemGpsFalha, pegarCoordsPrecisa } from "@/lib/geo";
import {
  descartarViagemGuiada,
  extras,
  getLifecycleLocal,
  proximoPassoObrigatorio,
  registrarEventoGuiado,
  type LifecycleLocal,
} from "@/lib/lifecycle";
import { useCatalogoEventos, useCatalogos } from "@/lib/queries";

export default function ViagemGuiada() {
  const catalogo = useCatalogoEventos();
  const catalogos = useCatalogos();
  const [local, setLocal] = useState<LifecycleLocal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sheetTipo, setSheetTipo] = useState<TipoEventoViagem | null>(null);

  // Recarrega o espelho local sempre que a tela ganha foco (volta do sheet,
  // do finalizar etc). Se não há viagem, volta pra home.
  const recarregar = useCallback(() => {
    let alive = true;
    void getLifecycleLocal().then((atual) => {
      if (!alive) return;
      if (!atual) {
        router.replace("/");
        return;
      }
      setLocal(atual);
      setCarregando(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(recarregar);

  const cat = catalogo.data ?? [];
  const slugsRegistrados = useMemo(
    () => (local ? local.eventos.map((e) => e.tipoSlug) : []),
    [local],
  );

  const proximo = useMemo(
    () => proximoPassoObrigatorio(cat, slugsRegistrados),
    [cat, slugsRegistrados],
  );
  const opcionais = useMemo(() => extras(cat), [cat]);

  const placa = useMemo(() => {
    const v = catalogos.data?.veiculos.find((x) => x.id === local?.veiculoId);
    return v?.placa ?? null;
  }, [catalogos.data?.veiculos, local?.veiculoId]);

  // Resumo do que já foi preenchido no fechamento (rascunho): descarga + campos.
  const descargaNome = useMemo(() => {
    const d = local?.finalizarDraft;
    if (!d?.localDescargaId) return null;
    return (
      d.descargaNome ??
      catalogos.data?.locais.find((l) => l.id === d.localDescargaId)?.nome ??
      "Local de descarga"
    );
  }, [local?.finalizarDraft, catalogos.data?.locais]);

  const resumoCampos = useMemo(() => {
    const d = local?.finalizarDraft;
    if (!d) return [] as { label: string; valor: string }[];
    const materialNome = catalogos.data?.materiais.find((m) => m.id === d.materialId)?.nome;
    const itens: { label: string; valor: string }[] = [];
    if (materialNome) itens.push({ label: "Material", valor: materialNome });
    if (d.toneladas?.trim()) itens.push({ label: "Toneladas", valor: `${d.toneladas} t` });
    if (d.ticket?.trim()) itens.push({ label: "Ticket", valor: d.ticket });
    if (d.km?.trim()) itens.push({ label: "Km", valor: `${d.km} km` });
    if (d.valorPedagio?.trim()) itens.push({ label: "Pedágio", valor: `R$ ${d.valorPedagio}` });
    return itens;
  }, [local?.finalizarDraft, catalogos.data?.materiais]);

  async function onEventoRegistrado() {
    setSheetTipo(null);
    const atual = await getLifecycleLocal();
    setLocal(atual);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function descartar() {
    if (!local) return;
    const ok = await showConfirm({
      title: "Descartar esta viagem?",
      message:
        "Os passos registrados neste celular serão apagados. Isso não dá pra desfazer.",
      confirmLabel: "Descartar",
      cancelLabel: "Não",
      destructive: true,
    });
    if (!ok) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    // Limpa a fila local E cancela no servidor (idempotente, enfileirado).
    await descartarViagemGuiada(local.clientId);
    router.replace("/");
  }

  if (carregando || catalogo.isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator />
        <Text className="mt-3 text-base text-muted-foreground">
          Carregando viagem…
        </Text>
      </SafeAreaView>
    );
  }

  if (!local) return null; // recarregar já redirecionou

  const clienteIdCarga = null; // lifecycle não amarra cliente até finalizar

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Viagem em andamento" />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}>
        {/* Cabeçalho: placa + local de carga + quando carregou */}
        <View className="rounded-2xl border-2 border-primary/30 bg-primary/10 p-5">
          <View className="flex-row items-center gap-2">
            <MapPin size={18} color="#ea580c" />
            <Text className="text-xs font-bold uppercase tracking-wider text-primary">
              Viagem em andamento
            </Text>
          </View>
          {placa ? (
            <Text
              className="mt-2 text-3xl font-extrabold text-foreground"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {placa}
            </Text>
          ) : null}
          <View className="mt-3 gap-1.5">
            {local.clienteNome ? (
              <View className="flex-row items-start gap-2">
                <User size={16} color="#64748b" style={{ marginTop: 2 }} />
                <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={2}>
                  {local.clienteNome}
                </Text>
              </View>
            ) : null}
            <View className="flex-row items-start gap-2">
              <MapPin size={16} color="#64748b" style={{ marginTop: 2 }} />
              <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={2}>
                {local.localCargaNome ?? "Local de carga não informado"}
              </Text>
            </View>
            <Text className="text-sm text-muted-foreground">
              Carregou {fmtDataHora(local.iniciadoEm)} · começou {tempoDesde(local.iniciadoEm)}
            </Text>
          </View>
        </View>

        {/* Timeline: o marco da carga (do espelho) + os extras registrados */}
        <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
          <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            O que já foi feito
          </Text>
          <View className="flex-row items-start gap-3">
            <View className="mt-0.5">
              <CheckCircle2 size={20} color="#16a34a" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">
                Carga{local.localCargaNome ? ` · ${local.localCargaNome}` : ""}
              </Text>
              <Text
                className="text-xs text-muted-foreground"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {fmtDataHora(local.iniciadoEm)}
              </Text>
            </View>
          </View>
          {local.eventos.map((e) => (
            <View key={e.id} className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CheckCircle2 size={20} color="#16a34a" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  {e.nome}
                  {e.localNome ? ` · ${e.localNome}` : ""}
                </Text>
                <Text
                  className="text-xs text-muted-foreground"
                  style={{ fontVariant: ["tabular-nums"] }}
                >
                  {fmtHora(e.ocorridoEm)}
                </Text>
              </View>
            </View>
          ))}

          {/* Descarga (marco, se já marcada no fechamento) */}
          {descargaNome ? (
            <View className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <CheckCircle2 size={20} color="#16a34a" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Descarga · {descargaNome}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Resumo do fechamento (rascunho) — campos já preenchidos */}
          {resumoCampos.length > 0 ? (
            <View className="mt-1 gap-1.5 border-t border-border pt-3">
              {resumoCampos.map((r) => (
                <View key={r.label} className="flex-row justify-between gap-3">
                  <Text className="text-sm text-muted-foreground">{r.label}</Text>
                  <Text
                    className="flex-1 text-right text-sm font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {r.valor}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* BOTÃO PRIMÁRIO GRANDE = próximo passo obrigatório, ou Finalizar */}
        {proximo ? (
          <Button
            size="lg"
            className="h-24"
            onPress={() => setSheetTipo(proximo)}
          >
            <Circle size={26} color="white" strokeWidth={2.5} />
            <Text className="text-2xl font-extrabold text-primary-foreground">
              {rotuloPrimario(proximo)}
            </Text>
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-24 bg-success"
            onPress={() => router.push("/finalizar-viagem")}
          >
            <Flag size={26} color="white" strokeWidth={2.5} />
            <Text className="text-2xl font-extrabold text-primary-foreground">
              Finalizar viagem
            </Text>
            <ArrowRight size={24} color="white" />
          </Button>
        )}

        {/* Botões secundários = eventos opcionais/repetíveis */}
        {opcionais.length > 0 && (
          <View className="gap-2">
            <Text className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Outros registros
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {opcionais.map((t) => (
                <Button
                  key={t.id}
                  variant="outline"
                  className="grow"
                  onPress={() => setSheetTipo(t)}
                >
                  <Text className="text-base font-semibold text-foreground">
                    + {t.nome}
                  </Text>
                </Button>
              ))}
            </View>
          </View>
        )}

        {/* Descartar — discreto */}
        <Button variant="ghost" onPress={descartar}>
          <Trash2 size={18} color="#dc2626" />
          <Text className="text-sm font-medium text-destructive">
            Descartar viagem
          </Text>
        </Button>
      </ScrollView>

      {/* Sheet de coleta do evento */}
      <EventoSheet
        tipo={sheetTipo}
        clienteId={clienteIdCarga}
        onFechar={() => setSheetTipo(null)}
        onRegistrado={onEventoRegistrado}
      />

    </SafeAreaView>
  );
}

/**
 * Modal que coleta só o que o TipoEventoViagem pede (pede*) e registra o
 * evento. Se ehCarga/ehDescarga + pedeGps, detecta o local por proximidade.
 */
function EventoSheet({
  tipo,
  clienteId,
  onFechar,
  onRegistrado,
}: {
  tipo: TipoEventoViagem | null;
  clienteId: string | null;
  onFechar: () => void;
  onRegistrado: () => void;
}) {
  const [local, setLocal] = useState<SelecaoLocal | null>(null);
  const [coords, setCoords] = useState<{
    lat: number;
    lng: number;
    precisao?: number;
    fonte?: FonteGps;
  } | null>(null);
  const [capturandoGps, setCapturandoGps] = useState(false);
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [toneladas, setToneladas] = useState("");
  const [valor, setValor] = useState("");
  const [ticket, setTicket] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Botão "Abrir ajustes" só quando a falha de GPS é de permissão (1 toque).
  const [erroAjustes, setErroAjustes] = useState(false);
  const val = useValidacaoGuiada();

  const visivel = tipo != null;
  const detectaLocal = !!tipo && tipo.pedeGps && (tipo.ehCarga || tipo.ehDescarga);
  // pedeGps sem ser carga/descarga: captura coords "solta" (ex: parada).
  const gpsSolto = !!tipo && tipo.pedeGps && !tipo.ehCarga && !tipo.ehDescarga;

  function reset() {
    setLocal(null);
    setCoords(null);
    setCapturandoGps(false);
    setFoto(null);
    setToneladas("");
    setValor("");
    setTicket("");
    setObservacao("");
    setSalvando(false);
    setErro(null);
    val.limpar();
  }

  function fechar() {
    reset();
    onFechar();
  }

  async function capturarGpsSolto() {
    setErro(null);
    setErroAjustes(false);
    setCapturandoGps(true);
    const res = await pegarCoordsPrecisa();
    setCapturandoGps(false);
    if (!res.ok) {
      const { msg, ajustes } = mensagemGpsFalha(res.motivo);
      setErro(msg);
      setErroAjustes(ajustes);
      return;
    }
    const c = res.coords;
    val.limpar();
    setCoords({ lat: c.lat, lng: c.lng, precisao: c.precisao ?? undefined, fonte: c.fonte });
  }

  async function salvar() {
    if (!tipo) return;
    setErro(null);
    setErroAjustes(false);

    if (detectaLocal && !local)
      return void val.apontar("local", "Marque o local por GPS");
    if (gpsSolto && !coords)
      return void val.apontar("gps", "Toque em “Marcar minha posição”");
    if (tipo.pedeToneladas && !toneladas.trim())
      return void val.apontar("toneladas", "Informe as toneladas");
    if (tipo.pedeValor && !valor.trim())
      return void val.apontar("valor", "Informe o valor");
    if (tipo.pedeTicket && !ticket.trim())
      return void val.apontar("ticket", "Informe o número do ticket");
    if (tipo.pedeFoto && !foto)
      return void val.apontar("foto", "Tire a foto pra continuar");
    val.limpar();

    setSalvando(true);
    try {
      // Coords do evento: do local detectado (carga/descarga) ou do gps solto.
      const coordsEvento =
        local?.lat != null && local?.lng != null
          ? { lat: local.lat, lng: local.lng, precisao: local.precisao ?? undefined, fonte: local.fonte }
          : coords ?? undefined;

      await registrarEventoGuiado({
        tipo,
        coords: coordsEvento,
        raioUsadoM: local?.raioUsadoM,
        local: local
          ? {
              id: local.id,
              nome: local.nome,
              lat: local.lat,
              lng: local.lng,
              criarOffline: local.criarOffline,
            }
          : undefined,
        foto: foto ? { uri: foto.uri, mime: foto.mime } : undefined,
        toneladas: tipo.pedeToneladas
          ? parseFloat(toneladas.replace(",", "."))
          : undefined,
        valor: tipo.pedeValor ? parseFloat(valor.replace(",", ".")) : undefined,
        ticket: tipo.pedeTicket ? ticket.trim() : undefined,
        observacao: tipo.pedeObservacao ? observacao.trim() || undefined : undefined,
      });
      reset();
      onRegistrado();
    } catch (err) {
      setErro(humanizeApiError(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSalvando(false);
    }
  }

  return (
    <Modal
      visible={visivel}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={fechar}
      statusBarTranslucent
    >
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        {tipo && (
          <>
            <ScreenHeaderLike title={`Registrar ${tipo.nome}`} onBack={fechar} />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              className="flex-1"
            >
              <ScrollView
                ref={val.scrollRef}
                contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}
                keyboardShouldPersistTaps="handled"
              >
                {/* Local por GPS (carga/descarga) */}
                {detectaLocal && (
                  <View
                    className={
                      val.erroDe("local")
                        ? "rounded-2xl border-2 border-destructive bg-destructive/5 p-3"
                        : undefined
                    }
                    onLayout={val.onLayoutCampo("local")}
                  >
                    <LocalPorGps
                      lado={tipo.ehDescarga ? "descarga" : "carga"}
                      ctaLabel={
                        tipo.ehDescarga
                          ? "Estou no local de descarga"
                          : "Estou no local de carga"
                      }
                      clienteId={clienteId}
                      value={local}
                      onSelect={(sel) => {
                        val.limpar();
                        setLocal(sel);
                      }}
                      onLimpar={() => setLocal(null)}
                    />
                    {val.erroDe("local") ? <ErroCampo msg={val.erroDe("local")!} /> : null}
                  </View>
                )}

                {/* GPS solto (parada etc) */}
                {gpsSolto && (
                  <View className="gap-2" onLayout={val.onLayoutCampo("gps")}>
                    <Label error={!!val.erroDe("gps")}>Onde você está</Label>
                    {coords ? (
                      <View className="flex-row items-center gap-3 rounded-2xl border-2 border-success/40 bg-success/15 p-4">
                        <CheckCircle2 size={20} color="#16a34a" />
                        <Text className="flex-1 text-base font-medium text-foreground">
                          Posição registrada
                        </Text>
                      </View>
                    ) : (
                      <Button
                        size="lg"
                        className="h-16"
                        onPress={capturarGpsSolto}
                        loading={capturandoGps}
                      >
                        <MapPin size={22} color="white" />
                        <Text className="text-base font-bold text-primary-foreground">
                          {capturandoGps ? "Buscando GPS…" : "Marcar minha posição"}
                        </Text>
                      </Button>
                    )}
                    {val.erroDe("gps") ? <ErroCampo msg={val.erroDe("gps")!} /> : null}
                  </View>
                )}

                {tipo.pedeToneladas && (
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
                )}

                {tipo.pedeValor && (
                  <View className="gap-2" onLayout={val.onLayoutCampo("valor")}>
                    <Label error={!!val.erroDe("valor")}>Valor (R$)</Label>
                    <Input
                      value={valor}
                      onChangeText={(v) => {
                        val.limpar();
                        setValor(v);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="0,00"
                      maxLength={10}
                      error={!!val.erroDe("valor")}
                    />
                    {val.erroDe("valor") ? <ErroCampo msg={val.erroDe("valor")!} /> : null}
                  </View>
                )}

                {tipo.pedeTicket && (
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

                {tipo.pedeFoto && (
                  <View className="gap-2" onLayout={val.onLayoutCampo("foto")}>
                    <Label error={!!val.erroDe("foto")}>Foto</Label>
                    <PhotoCapture
                      value={foto}
                      onChange={(f) => {
                        val.limpar();
                        setFoto(f);
                      }}
                    />
                    {val.erroDe("foto") ? <ErroCampo msg={val.erroDe("foto")!} /> : null}
                  </View>
                )}

                {tipo.pedeObservacao && (
                  <View className="gap-2">
                    <Label>Observação</Label>
                    <Input
                      value={observacao}
                      onChangeText={setObservacao}
                      placeholder="opcional"
                      maxLength={500}
                    />
                  </View>
                )}

                {erro ? (
                  <View className="gap-2">
                    <ErroCampo msg={erro} />
                    {erroAjustes && (
                      <Button
                        variant="outline"
                        onPress={() => void Linking.openSettings()}
                      >
                        <Text className="text-sm font-semibold text-foreground">
                          Abrir ajustes
                        </Text>
                      </Button>
                    )}
                  </View>
                ) : null}

                <Button size="lg" className="h-20" onPress={salvar} loading={salvando}>
                  <Check size={24} color="white" />
                  <Text className="text-xl font-bold text-primary-foreground">
                    {salvando ? "Salvando…" : `Registrar ${tipo.nome}`}
                  </Text>
                </Button>
              </ScrollView>
            </KeyboardAvoidingView>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/**
 * Header idêntico ao ScreenHeader mas com onBack custom (o do ScreenHeader
 * chama router.back(), que não fecha o Modal).
 */
function ScreenHeaderLike({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View className="bg-brand px-4 pb-4 pt-14">
      <View className="flex-row items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 rounded-full bg-white/15"
          onPress={onBack}
        >
          <Text className="text-2xl text-white">✕</Text>
        </Button>
        <Text className="flex-1 text-2xl font-bold text-white" numberOfLines={1}>
          {title}
        </Text>
      </View>
    </View>
  );
}

// Rótulo do botão primário. Frases guiadas pra carga/descarga; senão o nome.
function rotuloPrimario(t: TipoEventoViagem): string {
  return `Registrar ${t.nome}`;
}

function tempoDesde(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `há ${h}h${m > 0 ? ` ${m}min` : ""}`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? "s" : ""}`;
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** "14:30 de 02/07" — hora + dia/mês locais. */
function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${hh}:${mm} de ${dd}/${mo}`;
}
