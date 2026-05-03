import { useEffect, useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { ArrowLeft, Check, Plus } from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LocalNovoModal } from "@/components/local-novo-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { useCatalogos, useCriarViagem, useMe } from "@/lib/queries";

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
  const [modalLocal, setModalLocal] = useState<null | "carga" | "descarga">(null);

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
    const naObra = cat.data.locais.filter(
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
  }, [cat.data, form.obraId]);

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
      };
      await criar({
        payload,
        foto: foto ?? undefined,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      setErro((err as Error).message ?? "Erro ao salvar.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onPress={() => router.back()}>
          <ArrowLeft size={20} color="#0f172a" />
        </Button>
        <Text className="text-lg font-semibold text-foreground">Nova viagem</Text>
      </View>

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
              <Input
                value={form.data}
                onChangeText={(v) => update("data", v)}
                placeholder="AAAA-MM-DD"
                editable={!submitting}
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
                  onPress={() => setModalLocal("carga")}
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
                  onPress={() => setModalLocal("descarga")}
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
                  onChangeText={(v) => update("km", v)}
                  keyboardType="decimal-pad"
                  placeholder="0,00"
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

            <Button size="lg" onPress={salvar} loading={submitting}>
              <Check size={20} color="white" />
              <Text className="text-base font-medium text-primary-foreground">
                {submitting ? "Salvando..." : "Salvar viagem"}
              </Text>
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <LocalNovoModal
        open={modalLocal !== null}
        onClose={() => setModalLocal(null)}
        obraId={form.obraId || undefined}
        tipoSugerido={
          modalLocal === "descarga"
            ? "DESCARGA"
            : modalLocal === "carga"
              ? "CARGA"
              : "AMBOS"
        }
        onCreated={(novo) => {
          if (modalLocal === "carga") update("localCargaId", novo.id);
          if (modalLocal === "descarga") update("localDescargaId", novo.id);
        }}
      />
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

// UUID v4 simples sem dependência (crypto.randomUUID nem sempre tá em RN)
function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
