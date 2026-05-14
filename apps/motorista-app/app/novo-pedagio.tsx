import { useEffect, useMemo, useState } from "react";
import { router, Stack } from "expo-router";
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
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { humanizeApiError } from "@/lib/api";
import { humanizeZodError } from "@/lib/validation";
import { CriarPedagioInput } from "@ronan/shared-types";
import { useCatalogos, useCriarPedagio, useMe } from "@/lib/queries";

const today = () => new Date().toISOString().slice(0, 10);

export default function NovoPedagio() {
  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarPedagio();

  const [veiculoId, setVeiculoId] = useState("");
  const [data, setData] = useState(today());
  const [pracaPedagio, setPracaPedagio] = useState("");
  const [valor, setValor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (me.data?.veiculoDefaultId && !veiculoId) {
      setVeiculoId(me.data.veiculoDefaultId);
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

  async function salvar() {
    setErro(null);

    function falhar(msg: string) {
      setErro(msg);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    if (!veiculoId) return falhar("Escolha a placa.");
    if (!pracaPedagio.trim()) return falhar("Informe a praça do pedágio.");
    if (!valor.trim()) return falhar("Informe o valor.");

    const valorNum = parseFloat(valor.replace(",", "."));
    if (Number.isNaN(valorNum) || valorNum <= 0) {
      return falhar("Valor inválido.");
    }

    setSubmitting(true);
    try {
      const payload = {
        clientId: makeUuid(),
        veiculoId,
        data,
        pracaPedagio: pracaPedagio.trim(),
        valor: valorNum,
      };

      const parsed = CriarPedagioInput.safeParse(payload);
      if (!parsed.success) {
        setErro(humanizeZodError(parsed.error));
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setSubmitting(false);
        return;
      }

      await criar(payload);
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

      <ScreenHeader title="Novo pedágio" />

      {(cat.isLoading || me.isLoading) && !cat.data && !me.data && (
        <View className="items-center py-8">
          <ActivityIndicator />
          <Text className="mt-2 text-sm text-muted-foreground">Carregando dados...</Text>
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
              <Label>Data</Label>
              <DateField value={data} onChange={setData} disabled={submitting} />
            </View>

            <View className="gap-2">
              <Label>Praça do pedágio</Label>
              <Input
                value={pracaPedagio}
                onChangeText={setPracaPedagio}
                placeholder='ex: "Praça Reg. Norte BR-376"'
                autoCapitalize="words"
                editable={!submitting}
                maxLength={120}
              />
            </View>

            <View className="gap-2">
              <Label>Valor (R$)</Label>
              <Input
                value={valor}
                onChangeText={setValor}
                keyboardType="decimal-pad"
                placeholder="0,00"
                editable={!submitting}
                maxLength={10}
              />
              <Text className="text-xs text-muted-foreground">Em R$</Text>
            </View>

            {erro && <Text className="text-sm text-destructive">{erro}</Text>}

            <Button size="lg" className="h-20" onPress={salvar} loading={submitting}>
              <Check size={24} color="white" />
              <Text className="text-xl font-bold text-primary-foreground">
                {submitting ? "Salvando..." : "Salvar pedágio"}
              </Text>
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
