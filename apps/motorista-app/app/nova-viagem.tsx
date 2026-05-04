import { useCallback, useEffect, useMemo, useState } from "react";
import { router, Stack, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { Check, Plus } from "lucide-react-native";
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
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { humanizeApiError } from "@/lib/api";
import { consumePendingLocal } from "@/lib/local-novo-bridge";
import {
  useCalcularRota,
  useCatalogos,
  useCriarViagem,
  useMe,
  type Local,
} from "@/lib/queries";

type FormShape = {
  veiculoId: string;
  obraId: string;
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

const empty: FormShape = {
  veiculoId: "",
  obraId: "",
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

export default function NovaViagem() {
  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarViagem();

  const [form, setForm] = useState<FormShape>(empty);
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
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

  const rota = useCalcularRota(form.localCargaId, form.localDescargaId);

  // Auto-preenche KM com valor calculado pelo OSRM, se motorista nao editou
  useEffect(() => {
    if (kmEditadoManual) return;
    if (!rota.data || rota.data.km === null) return;
    const novoKm = rota.data.km;
    setForm((f) => (f.km === novoKm ? f : { ...f, km: novoKm }));
  }, [rota.data, kmEditadoManual]);

  useEffect(() => {
    let alive = true;
    void pegarCoords().then((c) => {
      if (alive && c) setCoords(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Quando volta da tela /local-novo, consome o local pendente
  useFocusEffect(
    useCallback(() => {
      const p = consumePendingLocal();
      if (!p) return;
      setExtraLocais((cur) =>
        cur.find((l) => l.id === p.local.id) ? cur : [...cur, p.local],
      );
      if (p.side === "carga") setForm((f) => ({ ...f, localCargaId: p.local.id }));
      if (p.side === "descarga")
        setForm((f) => ({ ...f, localDescargaId: p.local.id }));
    }, []),
  );

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

  const obraOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.obras ?? []).map((o) => ({
        value: o.id,
        label: o.nome,
        sublabel: o.empresaCliente.nome,
      })),
    [cat.data?.obras],
  );

  const materialOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.materiais ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [cat.data?.materiais],
  );

  const locaisFiltrados = useMemo(() => {
    if (!cat.data) return { carga: [], descarga: [] };
    const obraId = form.obraId || null;
    const todosIds = new Set(cat.data.locais.map((l) => l.id));
    const merged = [
      ...cat.data.locais,
      ...extraLocais.filter((l) => !todosIds.has(l.id)),
    ];
    const naObra = merged.filter(
      (l) => !obraId || l.obraId === obraId || l.obraId === null,
    );
    const opt = (l: (typeof naObra)[number]): SelectOption => ({
      value: l.id,
      label: l.nome,
      sublabel: `${l.cidade}/${l.uf}`,
    });
    return {
      carga: naObra.filter((l) => l.tipo === "CARGA" || l.tipo === "AMBOS").map(opt),
      descarga: naObra.filter((l) => l.tipo === "DESCARGA" || l.tipo === "AMBOS").map(opt),
    };
  }, [cat.data, form.obraId, extraLocais]);

  function update<K extends keyof FormShape>(k: K, v: FormShape[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function validar(): string | null {
    if (!form.veiculoId) return "Escolha a placa.";
    if (!form.obraId) return "Escolha a obra.";
    if (!form.materialId) return "Escolha o material.";
    if (!form.localCargaId) return "Escolha o local de carga.";
    if (!form.localDescargaId) return "Escolha o local de descarga.";
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

      const payload = {
        clientId: makeUuid(),
        veiculoId: form.veiculoId,
        obraId: form.obraId,
        materialId: form.materialId,
        data: form.data,
        toneladas: parseFloat(form.toneladas.replace(",", ".")),
        ticket: form.ticket.trim(),
        km: parseFloat(form.km.replace(",", ".")),
        localCargaId: form.localCargaId,
        localDescargaId: form.localDescargaId,
        valorPedagioTotal: form.valorPedagio
          ? parseFloat(form.valorPedagio.replace(",", "."))
          : undefined,
        observacao: form.observacao.trim() || undefined,
        criadoOfflineEm: new Date().toISOString(),
        ...(c ? { lat: c.lat, lng: c.lng } : {}),
      };
      await criar({
        payload,
        foto: foto ?? undefined,
      });
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

      <ScreenHeader title="Nova viagem" />

      {(cat.isLoading || me.isLoading) && !cat.data && !me.data && (
        <View className="items-center py-8">
          <ActivityIndicator />
          <Text className="mt-2 text-sm text-muted-foreground">Carregando dados...</Text>
        </View>
      )}

      {!cat.isLoading && !cat.data && (
        <View className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <Text className="font-medium text-amber-900">Sem dados de catálogo</Text>
          <Text className="mt-1 text-sm text-amber-800">
            Conecte na internet uma vez pra carregar veículos, obras, materiais e locais.
          </Text>
        </View>
      )}

      {cat.data && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
            keyboardShouldPersistTaps="handled"
          >
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

            <Field label="Obra">
              <Select
                value={form.obraId}
                onChange={(v) => update("obraId", v)}
                options={obraOptions}
                placeholder="Escolha a obra"
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
                />
              </View>
              <View className="flex-1 gap-2">
                <Label>Ticket</Label>
                <Input
                  value={form.ticket}
                  onChangeText={(v) => update("ticket", v)}
                  placeholder="número"
                />
              </View>
            </View>

            <Field label="Local de carga">
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Select
                    value={form.localCargaId}
                    onChange={(v) => update("localCargaId", v)}
                    options={locaisFiltrados.carga}
                    placeholder="Escolha o local"
                    searchable
                    emptyMessage="Nenhum local de carga pra essa obra"
                  />
                </View>
                <Button
                  variant="outline"
                  size="icon"
                  onPress={() =>
                    router.push({
                      pathname: "/local-novo",
                      params: { side: "carga", obraId: form.obraId || "" },
                    })
                  }
                >
                  <Plus size={20} color="#0f172a" />
                </Button>
              </View>
            </Field>

            <Field label="Local de descarga">
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Select
                    value={form.localDescargaId}
                    onChange={(v) => update("localDescargaId", v)}
                    options={locaisFiltrados.descarga}
                    placeholder="Escolha o local"
                    searchable
                    emptyMessage="Nenhum local de descarga pra essa obra"
                  />
                </View>
                <Button
                  variant="outline"
                  size="icon"
                  onPress={() =>
                    router.push({
                      pathname: "/local-novo",
                      params: { side: "descarga", obraId: form.obraId || "" },
                    })
                  }
                >
                  <Plus size={20} color="#0f172a" />
                </Button>
              </View>
            </Field>

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
                />
              </View>
            </View>

            <Field label="Observação" hint="opcional">
              <Input
                value={form.observacao}
                onChangeText={(v) => update("observacao", v)}
                placeholder="..."
              />
            </Field>

            <Field label="Foto do ticket" hint="opcional, mas ajuda na conferência">
              <PhotoCapture value={foto} onChange={setFoto} />
            </Field>

            {erro && <Text className="text-sm text-destructive">{erro}</Text>}

            <Button size="lg" className="h-20" onPress={salvar} loading={submitting}>
              <Check size={24} color="white" />
              <Text className="text-xl font-bold text-primary-foreground">
                {submitting ? "Salvando..." : "Salvar viagem"}
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

// UUID v4 simples sem dependência (crypto.randomUUID nem sempre tá em RN)
function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * GPS pre-aquecido: roda no background quando tela monta, com timeout
 * de 15s (suficiente pra fix frio do GPS). Lazy import previne crash
 * do boot do expo-router. Permissao negada / GPS off => null.
 */
async function pegarCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const Location = await import("expo-location");
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== "granted") {
      const r = await Location.requestForegroundPermissionsAsync();
      if (r.status !== "granted") return null;
    }
    // 1) tenta last-known (instantaneo, sem fix novo)
    const last = await Location.getLastKnownPositionAsync({
      maxAge: 60_000, // ate 1 min de idade
      requiredAccuracy: 200, // 200m suficiente pra contexto da viagem
    });
    if (last) {
      return { lat: last.coords.latitude, lng: last.coords.longitude };
    }
    // 2) fix novo com cap de 15s (cold lock pode levar ate 30s)
    const result = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    if (!result || !("coords" in result)) return null;
    return { lat: result.coords.latitude, lng: result.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Cap rapido (2s, so last-known) — usado no Salvar quando o pre-aquecimento
 * nao resolveu ainda. Nao trava o motorista esperando GPS frio.
 */
async function pegarCoordsRapido(): Promise<{ lat: number; lng: number } | null> {
  try {
    const Location = await import("expo-location");
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== "granted") return null;
    const last = await Promise.race([
      Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 500 }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (!last || !("coords" in last)) return null;
    return { lat: last.coords.latitude, lng: last.coords.longitude };
  } catch {
    return null;
  }
}
