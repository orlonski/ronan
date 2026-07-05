import { useMemo, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Scale } from "lucide-react-native";
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
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { ViagemAguardandoInfo } from "@/components/viagem-aguardando-info";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showAlert } from "@/lib/alert";
import { enqueueFoto } from "@/lib/sync";
import { useCompletarPeso, useViagensAguardandoPeso } from "@/lib/queries";

/**
 * Completa o peso + romaneio (ticket) de uma viagem que foi lançada sem o peso
 * (AGUARDANDO_PESO). Tela enxuta: só toneladas e ticket. Enfileira o
 * /completar-peso no outbox (funciona offline) e a viagem entra no fluxo normal.
 */
export default function CompletarPeso() {
  const { viagemId } = useLocalSearchParams<{ viagemId: string }>();
  const aguardando = useViagensAguardandoPeso();
  const completarPeso = useCompletarPeso();

  const viagem = useMemo(
    () => aguardando.data?.find((v) => v.id === viagemId),
    [aguardando.data, viagemId],
  );

  const [toneladas, setToneladas] = useState("");
  const [ticket, setTicket] = useState("");
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const val = useValidacaoGuiada();

  // Material que não exige ticket (ex: concreto) esconde o campo. Default true.
  const exigeTicket = viagem?.material?.exigeTicket ?? true;

  async function salvar() {
    setErro(null);
    if (!viagemId) return;
    const t = parseFloat(toneladas.replace(",", "."));
    if (!toneladas.trim() || Number.isNaN(t) || t <= 0) {
      return void val.apontar("toneladas", "Informe as toneladas");
    }
    if (t > 9999) {
      return void val.apontar("toneladas", "Toneladas acima do limite (9999)");
    }
    if (exigeTicket && !ticket.trim()) {
      return void val.apontar("ticket", "Informe o número do ticket");
    }
    val.limpar();
    setSubmitting(true);
    try {
      await completarPeso({
        viagemId,
        toneladas: t,
        ticket: exigeTicket ? ticket.trim() : undefined,
      });
      // Foto do ticket (opcional): anexa na viagem já sincronizada via outbox
      // próprio (upload 2-step). Mesmo caminho do "adicionar foto" do detalhe.
      if (foto) {
        await enqueueFoto({
          viagemId,
          fotoUri: foto.uri,
          fotoMime: foto.mime,
        });
      }
      // Quantas viagens ainda esperam peso depois desta? Se acabou, volta pra
      // home (não deixa o motorista numa lista vazia); se sobrou, volta pra
      // lista pra ele completar a próxima.
      const restantes = (aguardando.data ?? []).filter(
        (v) => v.id !== viagemId,
      ).length;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await showAlert({
        title: "Peso registrado!",
        message:
          restantes > 0
            ? `Pronto — essa entrou no fluxo normal. Ainda ${restantes === 1 ? "falta 1 viagem" : `faltam ${restantes} viagens`} esperando o peso.`
            : "Pronto — a viagem entrou no fluxo normal. Não sobrou nenhuma esperando o peso. Se estiver sem sinal, envia sozinho quando voltar.",
      });
      if (restantes > 0) router.back();
      else router.replace("/");
    } catch (e) {
      setErro((e as Error).message ?? "Não deu pra salvar. Tente de novo.");
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Completar peso" />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
      >
        <ScrollView
          ref={val.scrollRef}
          className="flex-1"
          contentContainerClassName="p-4 gap-5"
          keyboardShouldPersistTaps="handled"
        >
          {aguardando.isLoading && !viagem ? (
            <View className="items-center py-16">
              <ActivityIndicator />
            </View>
          ) : !viagem ? (
            <View className="gap-3 rounded-2xl bg-muted p-5">
              <Text className="text-lg font-bold text-foreground">
                Viagem não encontrada
              </Text>
              <Text className="text-base text-muted-foreground">
                Essa viagem pode já ter sido completada ou o app está sem sinal.
                Volte e tente de novo.
              </Text>
              <Button variant="outline" onPress={() => router.back()}>
                Voltar
              </Button>
            </View>
          ) : (
            <>
              {/* Contexto da viagem pro motorista saber qual é. */}
              <View className="flex-row items-start gap-3 rounded-2xl bg-amber-500/10 p-4">
                <Scale size={24} color="#d97706" style={{ marginTop: 2 }} />
                <ViagemAguardandoInfo viagem={viagem} />
              </View>

              <View onLayout={val.onLayoutCampo("toneladas")} className="gap-2">
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
                {val.erroDe("toneladas") ? (
                  <ErroCampo msg={val.erroDe("toneladas")!} />
                ) : (
                  <Text className="text-xs text-muted-foreground">
                    O peso que saiu no romaneio (máx 9999).
                  </Text>
                )}
              </View>

              {exigeTicket ? (
                <View onLayout={val.onLayoutCampo("ticket")} className="gap-2">
                  <Label error={!!val.erroDe("ticket")}>Ticket (romaneio)</Label>
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
                  {val.erroDe("ticket") ? (
                    <ErroCampo msg={val.erroDe("ticket")!} />
                  ) : null}
                </View>
              ) : (
                <Text className="text-sm text-muted-foreground">
                  Esse material não exige ticket — pode salvar só com o peso.
                </Text>
              )}

              {/* Foto do romaneio/ticket (opcional) — anexa na viagem. */}
              <View className="gap-2">
                <Label>Foto do ticket (opcional)</Label>
                <PhotoCapture value={foto} onChange={setFoto} />
                <Text className="text-xs text-muted-foreground">
                  Se tiver o papel do romaneio em mãos, tire uma foto pra ficar
                  junto da viagem.
                </Text>
              </View>

              {erro ? <ErroCampo msg={erro} /> : null}

              <Button onPress={salvar} loading={submitting} disabled={submitting}>
                Salvar peso
              </Button>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
