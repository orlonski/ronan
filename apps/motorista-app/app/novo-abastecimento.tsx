import { useEffect, useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
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
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { fmtDataBR, hojeISO } from "@/lib/datetime";
import { humanizeZodError } from "@/lib/validation";
import { CriarAbastecimentoInput } from "@ronan/shared-types";
import {
  useAbastecimentos,
  useCatalogos,
  useCriarAbastecimento,
  useMe,
  usePostosRecentes,
} from "@/lib/queries";
import { pegarCoordsPrecisa } from "@/lib/geo";

type TipoCombustivel =
  | "DIESEL_S10"
  | "DIESEL_S500"
  | "ARLA_32"
  | "GASOLINA"
  | "ETANOL";

const TIPOS: { value: TipoCombustivel; label: string }[] = [
  { value: "DIESEL_S10", label: "Diesel S10" },
  { value: "DIESEL_S500", label: "Diesel S500" },
  { value: "ARLA_32", label: "ARLA 32" },
  { value: "GASOLINA", label: "Gasolina" },
  { value: "ETANOL", label: "Etanol" },
];

const today = hojeISO;

export default function NovoAbastecimento() {
  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarAbastecimento();
  const postos = usePostosRecentes();
  // Pra validação de odômetro local: lista de abastecimentos do mês atual.
  // Não é 100% (motorista pode ter abastecido no mês passado e estar sem net),
  // mas cobre 95% dos casos. Server-side faz checagem definitiva.
  const recentes = useAbastecimentos();

  const [veiculoId, setVeiculoId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [data, setData] = useState(today());
  const [tipo, setTipo] = useState<TipoCombustivel>("DIESEL_S10");
  const [litros, setLitros] = useState("");
  const [valor, setValor] = useState("");
  const [emComboio, setEmComboio] = useState(false);
  const [odometro, setOdometro] = useState("");
  const [postoNome, setPostoNome] = useState("");
  const [tanqueCheio, setTanqueCheio] = useState(true);
  const [observacao, setObservacao] = useState("");
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [coords, setCoords] = useState<{
    lat: number;
    lng: number;
    precisao?: number;
  } | null>(null);

  useEffect(() => {
    if (me.data?.veiculoDefaultId && !veiculoId) {
      setVeiculoId(me.data.veiculoDefaultId);
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS pré-aquece em background
  useEffect(() => {
    let alive = true;
    void pegarCoordsPrecisa().then((c) => {
      if (alive && c) {
        setCoords({ lat: c.lat, lng: c.lng, precisao: c.precisao ?? undefined });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const veiculoOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.veiculos ?? []).map((v) => ({
        value: v.id,
        label: v.placa,
        sublabel: v.modelo ?? undefined,
      })),
    [cat.data?.veiculos],
  );

  const empresaOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.empresas ?? []).map((e) => ({
        value: e.id,
        label: e.nome,
      })),
    [cat.data?.empresas],
  );

  const tipoOptions: SelectOption[] = useMemo(
    () => TIPOS.map((t) => ({ value: t.value, label: t.label })),
    [],
  );

  // Preço por litro calculado (R$)
  const precoLitro = useMemo(() => {
    const l = parseFloat(litros.replace(",", "."));
    const v = parseFloat(valor.replace(",", "."));
    if (!Number.isFinite(l) || !Number.isFinite(v) || l <= 0) return null;
    return v / l;
  }, [litros, valor]);

  // Último odômetro registrado pro veículo no cache local
  const ultimoOdometroDoVeiculo = useMemo<number | null>(() => {
    if (!veiculoId || !recentes.data) return null;
    const doVeiculo = recentes.data.filter((a) => a.veiculo.id === veiculoId);
    if (doVeiculo.length === 0) return null;
    return Math.max(...doVeiculo.map((a) => a.odometro));
  }, [veiculoId, recentes.data]);

  async function salvar() {
    setErro(null);
    function falhar(msg: string) {
      setErro(msg);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    if (!veiculoId) return falhar("Escolha a placa.");
    if (!empresaId) return falhar("Escolha a empresa.");
    const litrosNum = parseFloat(litros.replace(",", "."));
    if (!Number.isFinite(litrosNum) || litrosNum <= 0) {
      return falhar("Informe os litros.");
    }
    const valorNum = parseFloat(valor.replace(",", "."));
    if (!emComboio && (!Number.isFinite(valorNum) || valorNum <= 0)) {
      return falhar("Informe o valor (ou marque \"em comboio\").");
    }
    const odometroNum = parseInt(odometro.replace(/\D/g, ""), 10);
    if (!Number.isFinite(odometroNum) || odometroNum < 0) {
      return falhar("Informe o odômetro.");
    }
    if (
      ultimoOdometroDoVeiculo !== null &&
      odometroNum < ultimoOdometroDoVeiculo
    ) {
      return falhar(
        `Odômetro (${odometroNum} km) é menor que o último registrado pra esse veículo (${ultimoOdometroDoVeiculo} km).`,
      );
    }

    let dataFinal = data;
    if (dataFinal !== hojeISO()) {
      const escolha = await showAlert({
        title: "Data diferente de hoje",
        message: `O abastecimento está marcado como ${fmtDataBR(dataFinal)}. Hoje é ${fmtDataBR(hojeISO())}. Tem certeza?`,
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
        setData(dataFinal);
      }
    }

    setSubmitting(true);
    try {
      const c = coords ?? (await pegarCoordsRapido());

      const payload = {
        clientId: makeUuid(),
        veiculoId,
        empresaId,
        // Combina data (YYYY-MM-DD) com hora atual pra timestamp completo
        data: combinarDataComHoraAtual(dataFinal),
        tipo,
        litros: litrosNum,
        valorTotal: emComboio ? undefined : valorNum,
        emComboio,
        odometro: odometroNum,
        postoNome: postoNome.trim() || undefined,
        tanqueCheio,
        observacao: observacao.trim() || undefined,
        criadoOfflineEm: new Date().toISOString(),
        ...(c
          ? { lat: c.lat, lng: c.lng, ...(c.precisao ? { precisao: c.precisao } : {}) }
          : {}),
      };
      const parsed = CriarAbastecimentoInput.safeParse(payload);
      if (!parsed.success) {
        setErro(humanizeZodError(parsed.error));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setSubmitting(false);
        return;
      }

      await criar({ payload, foto: foto ?? undefined });
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

      <ScreenHeader title="Novo abastecimento" />

      {(cat.isLoading || me.isLoading) && !cat.data && !me.data && (
        <View className="items-center py-8">
          <ActivityIndicator />
          <Text className="mt-2 text-sm text-muted-foreground">
            Carregando dados...
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
            <View className="gap-2">
              <Label>Placa</Label>
              <Select
                value={veiculoId}
                onChange={setVeiculoId}
                options={veiculoOptions}
                placeholder="Escolha a placa"
                searchable
              />
            </View>

            <View className="gap-2">
              <Label>Empresa</Label>
              <Select
                value={empresaId}
                onChange={setEmpresaId}
                options={empresaOptions}
                placeholder="Escolha a empresa"
                searchable
                emptyMessage="Nenhuma empresa cadastrada"
              />
            </View>

            <View className="gap-2">
              <Label>Data</Label>
              <DateField value={data} onChange={setData} disabled={submitting} />
            </View>

            <View className="gap-2">
              <Label>Tipo de combustível</Label>
              <Select
                value={tipo}
                onChange={(v) => setTipo(v as TipoCombustivel)}
                options={tipoOptions}
                placeholder="Tipo"
              />
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1 gap-2">
                <Label>Litros</Label>
                <Input
                  value={litros}
                  onChangeText={setLitros}
                  keyboardType="decimal-pad"
                  placeholder="0,000"
                  editable={!submitting}
                  maxLength={8}
                />
                <Text className="text-xs text-muted-foreground">
                  Em litros (máx 2000)
                </Text>
              </View>
              <View className="flex-1 gap-2">
                <Label>Valor (R$)</Label>
                <Input
                  value={emComboio ? "" : valor}
                  onChangeText={setValor}
                  keyboardType="decimal-pad"
                  placeholder={emComboio ? "—" : "0,00"}
                  editable={!submitting && !emComboio}
                  maxLength={8}
                />
                <Text className="text-xs text-muted-foreground">
                  {emComboio ? "Preenchido depois pelo escritório" : "Em R$ (máx 50000)"}
                </Text>
              </View>
            </View>

            <View className="flex-row items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <Switch
                value={emComboio}
                onValueChange={setEmComboio}
                disabled={submitting}
              />
              <View className="flex-1">
                <Text className="text-sm font-medium text-foreground">
                  Abastecimento em comboio
                </Text>
                <Text className="mt-0.5 text-xs text-muted-foreground">
                  Marque se ainda não soube o valor. O escritório completa depois.
                </Text>
              </View>
            </View>

            {!emComboio && precoLitro !== null && (
              <View className="rounded-md bg-muted px-3 py-2">
                <Text className="text-xs text-muted-foreground">
                  Preço por litro
                </Text>
                <Text className="text-base font-semibold">
                  R$ {precoLitro.toFixed(3).replace(".", ",")}/L
                </Text>
              </View>
            )}

            <View className="gap-2">
              <Label>Odômetro (km)</Label>
              <Input
                value={odometro}
                onChangeText={(v) => setOdometro(v.replace(/\D/g, ""))}
                keyboardType="number-pad"
                placeholder="123456"
                editable={!submitting}
                maxLength={8}
              />
              {ultimoOdometroDoVeiculo !== null && (
                <Text className="text-xs text-muted-foreground">
                  Último registrado: {ultimoOdometroDoVeiculo.toLocaleString("pt-BR")} km
                </Text>
              )}
            </View>

            <View className="gap-2">
              <Label>Posto</Label>
              <Input
                value={postoNome}
                onChangeText={setPostoNome}
                placeholder='ex: "Posto Trevo BR-376"'
                autoCapitalize="words"
                editable={!submitting}
                maxLength={120}
              />
              {postos.data && postos.data.length > 0 && (
                <View className="flex-row flex-wrap gap-1">
                  {postos.data.slice(0, 5).map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setPostoNome(p)}
                      className="rounded-full border border-border bg-muted/40 px-3 py-1"
                    >
                      <Text className="text-xs">{p}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View className="flex-row items-center justify-between rounded-lg border border-border p-3">
              <View className="flex-1 pr-2">
                <Text className="font-medium">Tanque cheio</Text>
                <Text className="text-xs text-muted-foreground">
                  Marque se completou o tanque — usado pra calcular consumo médio.
                </Text>
              </View>
              <Switch
                value={tanqueCheio}
                onValueChange={setTanqueCheio}
                disabled={submitting}
              />
            </View>

            <View className="gap-2">
              <Label>Observação</Label>
              <Input
                value={observacao}
                onChangeText={setObservacao}
                placeholder="opcional"
                editable={!submitting}
                maxLength={500}
              />
            </View>

            <View className="gap-2">
              <Label>Foto do comprovante</Label>
              <Text className="text-xs text-muted-foreground">opcional</Text>
              <PhotoCapture value={foto} onChange={setFoto} />
            </View>

            {erro && <Text className="text-sm text-destructive">{erro}</Text>}

            <Button size="lg" className="h-20" onPress={salvar} loading={submitting}>
              <Check size={24} color="white" />
              <Text className="text-xl font-bold text-primary-foreground">
                {submitting ? "Salvando..." : "Salvar abastecimento"}
              </Text>
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function combinarDataComHoraAtual(dataYmd: string): string {
  const agora = new Date();
  const [y, m, d] = dataYmd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1, agora.getHours(), agora.getMinutes(), agora.getSeconds());
  return dt.toISOString();
}

function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function pegarCoordsRapido(): Promise<{
  lat: number;
  lng: number;
  precisao?: number;
} | null> {
  try {
    const Location = await import("expo-location");
    const cur = await Location.getForegroundPermissionsAsync();
    if (cur.status !== "granted") return null;
    const last = await Promise.race([
      Location.getLastKnownPositionAsync({
        maxAge: 5 * 60_000,
        requiredAccuracy: 500,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (!last || !("coords" in last)) return null;
    return {
      lat: last.coords.latitude,
      lng: last.coords.longitude,
      precisao: last.coords.accuracy ?? undefined,
    };
  } catch {
    return null;
  }
}
