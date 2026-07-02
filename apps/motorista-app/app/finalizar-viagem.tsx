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
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { hojeISO } from "@/lib/datetime";
import { finalizarViagemGuiada, getLifecycleLocal, type LifecycleLocal } from "@/lib/lifecycle";
import { useCalcularRota, useCatalogos } from "@/lib/queries";

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
  const [localDescargaId, setLocalDescargaId] = useState("");
  const [descargaCaptura, setDescargaCaptura] = useState<DescargaCaptura | null>(null);
  const [valorPedagio, setValorPedagio] = useState("");
  const [observacao, setObservacao] = useState("");
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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

  useEffect(() => {
    if (kmEditadoManual) return;
    if (!rota.data || rota.data.km === null) return;
    setKm((cur) => (cur === rota.data!.km ? cur : (rota.data as { km: string }).km));
  }, [rota.data, kmEditadoManual]);

  const nomeDescargaSelecionado = useMemo(() => {
    if (!localDescargaId) return undefined;
    return cat.data?.locais.find((l) => l.id === localDescargaId)?.nome;
  }, [localDescargaId, cat.data?.locais]);

  const localCargaCoords = useMemo(() => {
    if (!localCargaId) return null;
    const l = cat.data?.locais.find((x) => x.id === localCargaId);
    if (!l || l.lat == null || l.lng == null) return null;
    return { lat: l.lat, lng: l.lng, nome: l.nome };
  }, [localCargaId, cat.data?.locais]);

  function validar(): string | null {
    if (!clienteId) return "Escolha o cliente.";
    if (!materialId) return "Escolha o material.";
    if (!toneladas.trim()) return "Informe as toneladas.";
    if (exigeTicket && !ticket.trim()) return "Informe o ticket.";
    if (!km.trim()) return "Informe os km rodados.";
    if (!localDescargaId) return "Aperte 'Estou no local de descarga'.";
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
        kmCalculado:
          rota.data && "km" in rota.data && rota.data.km !== null
            ? parseFloat(String(rota.data.km))
            : undefined,
        ticket: exigeTicket ? ticket.trim() : undefined,
        localDescargaId,
        localDescargaDados,
        descargaLat: descargaCaptura?.lat,
        descargaLng: descargaCaptura?.lng,
        descargaPrecisao: descargaCaptura?.precisao ?? undefined,
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
        <View className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <Text className="font-medium text-amber-900">Sem dados de catálogo</Text>
          <Text className="mt-1 text-sm text-amber-800">
            Conecte na internet uma vez pra carregar clientes, materiais e locais.
          </Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* 1) Onde descarregou — captura já dispara sozinha ao abrir a tela
                   (o motorista veio do "Finalizar viagem" acabando de descarregar). */}
            <DescargaPorGps
              autoIniciar={!localDescargaId}
              clienteId={clienteId || null}
              value={localDescargaId}
              onChange={setLocalDescargaId}
              onCaptura={setDescargaCaptura}
              nomeSelecionadoFallback={nomeDescargaSelecionado}
              localCargaCoords={localCargaCoords}
            />

            {/* 2) Cliente (já escolhido no início) + material */}
            <View className="gap-1.5">
              <Label>Cliente</Label>
              <View className="rounded-xl border border-border bg-muted/40 px-3 py-3">
                <Text className="text-base font-semibold text-foreground">
                  {ciclo?.clienteNome ?? "—"}
                </Text>
              </View>
            </View>

            <View className="gap-2">
              <Label>Material</Label>
              <Select
                value={materialId}
                onChange={setMaterialId}
                options={materialOptions}
                placeholder="Escolha o material"
                searchable
              />
              {!exigeTicket && materialId ? (
                <Text className="text-xs text-muted-foreground">
                  Esse material não exige ticket — pode lançar sem número.
                </Text>
              ) : null}
            </View>

            {/* 3) Km e pedágio */}
            <View className="flex-row gap-3">
              <View className="flex-1 gap-2">
                <Label>Km rodados</Label>
                <Input
                  value={km}
                  onChangeText={(v) => {
                    setKmEditadoManual(true);
                    setKm(v);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
                  maxLength={8}
                />
                {rota.isFetching && !kmEditadoManual ? (
                  <Text className="text-xs text-muted-foreground">Calculando rota…</Text>
                ) : rota.data && "km" in rota.data && rota.data.km && !kmEditadoManual ? (
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

            {/* 4) Ticket (se o material exigir) + foto */}
            {exigeTicket && (
              <View className="gap-2">
                <Label>Ticket</Label>
                <Input
                  value={ticket}
                  onChangeText={(v) => setTicket(v.toUpperCase())}
                  placeholder="número"
                  maxLength={50}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
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
            <View className="gap-2">
              <Label>Toneladas</Label>
              <Input
                value={toneladas}
                onChangeText={setToneladas}
                keyboardType="decimal-pad"
                placeholder="0,000"
                maxLength={8}
              />
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

            {erro && <Text className="text-sm text-destructive">{erro}</Text>}

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
