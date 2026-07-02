import { useEffect, useState } from "react";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import { ArrowRight, Play } from "lucide-react-native";
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
import { LocalPorGps, type SelecaoLocal } from "@/components/local-por-gps";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { getLifecycleLocal, iniciarViagemGuiada } from "@/lib/lifecycle";
import { useCatalogos, useMe } from "@/lib/queries";

/**
 * Passo 1 do lifecycle guiado: escolher a placa e (opcional) marcar o local
 * de carga por GPS. Ao confirmar, abre a viagem (enfileira o /iniciar) e vai
 * pra tela de andamento.
 */
export default function IniciarViagem() {
  const me = useMe();
  const cat = useCatalogos();
  const [veiculoId, setVeiculoId] = useState("");
  const [localCarga, setLocalCarga] = useState<SelecaoLocal | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Já tem viagem aberta? Não deixa abrir duas — redireciona pra andamento.
  const [checando, setChecando] = useState(true);

  useEffect(() => {
    let alive = true;
    void getLifecycleLocal().then((atual) => {
      if (!alive) return;
      if (atual) {
        router.replace("/viagem-guiada");
        return;
      }
      setChecando(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Pré-seleciona a placa default do motorista.
  useEffect(() => {
    if (me.data?.veiculoDefaultId && !veiculoId) {
      setVeiculoId(me.data.veiculoDefaultId);
    }
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const veiculoOptions: SelectOption[] = (
    cat.data?.veiculos ??
    me.data?.veiculos ??
    []
  ).map((v) => ({ value: v.id, label: v.placa, sublabel: v.modelo ?? undefined }));

  async function confirmar() {
    setErro(null);
    if (!veiculoId) {
      setErro("Escolha a placa.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setSubmitting(true);
    try {
      await iniciarViagemGuiada({
        veiculoId,
        coords: localCarga?.lat != null && localCarga?.lng != null
          ? { lat: localCarga.lat, lng: localCarga.lng, precisao: localCarga.precisao ?? undefined }
          : undefined,
        localCarga: localCarga
          ? {
              id: localCarga.id,
              nome: localCarga.nome,
              lat: localCarga.lat,
              lng: localCarga.lng,
              criarOffline: localCarga.criarOffline,
            }
          : undefined,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/viagem-guiada");
    } catch (err) {
      setErro(humanizeApiError(err));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSubmitting(false);
    }
  }

  if (checando) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Iniciar viagem" />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}
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

          {/* Local de carga — detecta por GPS entre os locais cadastrados. */}
          <View className="gap-2">
            <LocalPorGps
              lado="carga"
              ctaLabel="Estou no local de carga"
              value={localCarga}
              onSelect={setLocalCarga}
              onLimpar={() => setLocalCarga(null)}
            />
            <Text className="text-xs text-muted-foreground">
              Toque quando estiver no pátio de carga — o app acha o local pela
              sua posição. Marca aqui a hora que você carregou.
            </Text>
          </View>

          {erro && <Text className="text-sm text-destructive">{erro}</Text>}

          <Button size="lg" className="h-20" onPress={confirmar} loading={submitting}>
            <Play size={24} color="white" fill="white" />
            <Text className="text-xl font-bold text-primary-foreground">
              {submitting ? "Abrindo..." : "Começar viagem"}
            </Text>
            {!submitting && <ArrowRight size={22} color="white" />}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
