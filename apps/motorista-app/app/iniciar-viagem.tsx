import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { showAlert } from "@/lib/alert";
import { humanizeApiError } from "@/lib/api";
import { hidratarViagemDoServidor, iniciarViagemGuiada } from "@/lib/lifecycle";
import { useCatalogos, useMe } from "@/lib/queries";

/**
 * Passo 1 do lifecycle guiado: escolher a placa e (opcional) marcar o local
 * de carga por GPS. Ao confirmar, abre a viagem (enfileira o /iniciar) e vai
 * pra tela de andamento.
 */
export default function IniciarViagem() {
  const me = useMe();
  const cat = useCatalogos();
  const qc = useQueryClient();
  const [veiculoId, setVeiculoId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [localCarga, setLocalCarga] = useState<SelecaoLocal | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const v = useValidacaoGuiada();
  // Já tem viagem aberta? Não deixa abrir duas — redireciona pra andamento.
  const [checando, setChecando] = useState(true);

  useEffect(() => {
    let alive = true;
    // Catálogo fresco (clientes/locais atuais — evita cliente/local excluído).
    void qc.invalidateQueries({ queryKey: ["catalogos"] });
    // Reconcilia com o servidor: se já existe viagem em andamento (local ou
    // órfã no servidor), retoma em vez de deixar abrir outra (evita o 409).
    void hidratarViagemDoServidor().then((atual) => {
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const clienteOptions: SelectOption[] = (cat.data?.clientes ?? []).map((c) => ({
    value: c.id,
    label: c.nome,
    sublabel: c.empresa?.nome ?? undefined,
  }));
  const clienteNome = useMemo(
    () => cat.data?.clientes.find((c) => c.id === clienteId)?.nome,
    [cat.data?.clientes, clienteId],
  );

  async function confirmar() {
    setErro(null);
    if (!veiculoId) return void v.apontar("placa", "Escolha a placa do caminhão");
    if (!clienteId) return void v.apontar("cliente", "Escolha o cliente");
    if (!localCarga)
      return void v.apontar("carga", "Toque em “Estou no local de carga” e marque o local");
    v.limpar();
    setSubmitting(true);
    try {
      await iniciarViagemGuiada({
        veiculoId,
        clienteId,
        clienteNome,
        coords: localCarga?.lat != null && localCarga?.lng != null
          ? { lat: localCarga.lat, lng: localCarga.lng, precisao: localCarga.precisao ?? undefined }
          : undefined,
        localCarga: {
          id: localCarga.id,
          nome: localCarga.nome,
          lat: localCarga.lat,
          lng: localCarga.lng,
          criarOffline: localCarga.criarOffline,
        },
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
          ref={v.scrollRef}
          contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2" onLayout={v.onLayoutCampo("placa")}>
            <Label error={!!v.erroDe("placa")}>Placa</Label>
            <Select
              value={veiculoId}
              onChange={(x) => {
                v.limpar();
                setVeiculoId(x);
              }}
              options={veiculoOptions}
              placeholder="Escolha a placa"
              searchable
              error={!!v.erroDe("placa")}
            />
            {v.erroDe("placa") ? <ErroCampo msg={v.erroDe("placa")!} /> : null}
          </View>

          <View className="gap-2" onLayout={v.onLayoutCampo("cliente")}>
            <Label error={!!v.erroDe("cliente")}>Cliente</Label>
            <Select
              value={clienteId}
              onChange={(x) => {
                v.limpar();
                setClienteId(x);
                setLocalCarga(null); // troca de cliente reseta o local de carga
              }}
              options={clienteOptions}
              placeholder="Escolha o cliente"
              searchable
              error={!!v.erroDe("cliente")}
            />
            {v.erroDe("cliente") ? <ErroCampo msg={v.erroDe("cliente")!} /> : null}
          </View>

          {/* Local de carga — só depois do cliente (busca só locais dele/perto). */}
          {clienteId ? (
            <View
              className={
                v.erroDe("carga")
                  ? "gap-2 rounded-2xl border-2 border-destructive bg-destructive/5 p-3"
                  : "gap-2"
              }
              onLayout={v.onLayoutCampo("carga")}
            >
              <LocalPorGps
                lado="carga"
                ctaLabel="Estou no local de carga"
                clienteId={clienteId}
                value={localCarga}
                onSelect={(sel) => {
                  v.limpar();
                  setLocalCarga(sel);
                }}
                onLimpar={() => setLocalCarga(null)}
              />
              {v.erroDe("carga") ? (
                <ErroCampo msg={v.erroDe("carga")!} />
              ) : (
                <Text className="text-xs text-muted-foreground">
                  Toque quando estiver no pátio de carga — o app acha o local desse
                  cliente pela sua posição. Marca aqui a hora que você carregou.
                </Text>
              )}
            </View>
          ) : (
            <Text className="text-sm text-muted-foreground">
              Escolha o cliente pra marcar o local de carga.
            </Text>
          )}

          {erro ? <ErroCampo msg={erro} /> : null}

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
