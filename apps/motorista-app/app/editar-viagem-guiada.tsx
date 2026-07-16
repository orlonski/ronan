import { useEffect, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { PhotoCapture, type CapturedPhoto } from "@/components/photo-capture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showAlert } from "@/lib/alert";
import { atualizarViagemFinalizarPendente } from "@/lib/sync";
import { listPendingViagemFinalizar } from "@/db/database";

/**
 * Corrige uma viagem guiada cujo FINALIZAR ficou preso com erro 4xx real
 * (ex: "toneladas acima do máximo"). Tela enxuta — só toneladas e ticket, os
 * campos que o motorista digita e que causam a recusa. Lê o payload do outbox
 * (listPendingViagemFinalizar), corrige e re-enfileira o MESMO clientId
 * (idempotente no backend). Não mexe em rota/km/descarga; pra isso a viagem
 * teria que ser reaberta inteira, o que não é o caso destes erros.
 */
export default function EditarViagemGuiada() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const [carregando, setCarregando] = useState(true);
  const [achou, setAchou] = useState(false);
  const [tinhaTicket, setTinhaTicket] = useState(false);
  const [toneladas, setToneladas] = useState("");
  const [ticket, setTicket] = useState("");
  const [foto, setFoto] = useState<CapturedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const val = useValidacaoGuiada();

  useEffect(() => {
    let alive = true;
    void (async () => {
      const item = (await listPendingViagemFinalizar()).find((x) => x.clientId === clientId);
      if (!alive) return;
      if (item) {
        const p = item.payload as { toneladas?: number; ticket?: string };
        setToneladas(p.toneladas != null ? String(p.toneladas).replace(".", ",") : "");
        setTicket(p.ticket ?? "");
        setTinhaTicket(!!p.ticket);
        setAchou(true);
      }
      setCarregando(false);
    })();
    return () => {
      alive = false;
    };
  }, [clientId]);

  async function salvar() {
    setErro(null);
    if (!clientId) return;
    const t = parseFloat(toneladas.replace(",", "."));
    if (!toneladas.trim() || Number.isNaN(t) || t <= 0) {
      return void val.apontar("toneladas", "Informe as toneladas");
    }
    if (t > 9999) {
      return void val.apontar("toneladas", "Toneladas acima do limite (9999)");
    }
    // Só exige ticket se a viagem já tinha um (não sabemos exigeTicket do
    // material aqui; se o material não exige, o ticket vem vazio e tudo bem).
    if (tinhaTicket && !ticket.trim()) {
      return void val.apontar("ticket", "Informe o número do ticket");
    }
    val.limpar();
    setSubmitting(true);
    try {
      const r = await atualizarViagemFinalizarPendente({
        clientId,
        patch: { toneladas: t, ticket: ticket.trim() || undefined },
        foto: foto ? { uri: foto.uri, mime: foto.mime } : undefined,
      });
      if (r.removed) {
        await showAlert({
          title: "Já foi enviada",
          message: "Essa viagem já saiu da fila — provavelmente sincronizou. Nada a corrigir.",
        });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      setErro((e as Error).message ?? "Não deu pra salvar. Tente de novo.");
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Corrigir viagem" />
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          ref={val.scrollRef}
          className="flex-1"
          contentContainerClassName="p-4 gap-5"
          keyboardShouldPersistTaps="handled"
        >
          {carregando ? (
            <View className="items-center py-16">
              <ActivityIndicator />
            </View>
          ) : !achou ? (
            <View className="gap-3 rounded-2xl bg-muted p-5">
              <Text className="text-lg font-bold text-foreground">Viagem não encontrada</Text>
              <Text className="text-base text-muted-foreground">
                Essa viagem pode já ter sido enviada ou descartada. Volte e veja a lista.
              </Text>
              <Button variant="outline" onPress={() => router.back()}>
                Voltar
              </Button>
            </View>
          ) : (
            <>
              <View className="gap-1 rounded-2xl bg-amber-500/10 p-4">
                <Text className="text-base font-semibold text-foreground">
                  Corrija o que o servidor recusou
                </Text>
                <Text className="text-sm text-muted-foreground">
                  Ajuste as toneladas (ou o ticket) e salve — o resto da viagem fica igual.
                </Text>
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
                    Use vírgula pros decimais (ex: 38,230). Máximo 9999.
                  </Text>
                )}
              </View>

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
                {val.erroDe("ticket") ? <ErroCampo msg={val.erroDe("ticket")!} /> : null}
              </View>

              <View className="gap-2">
                <Label>Foto do ticket (opcional)</Label>
                <PhotoCapture value={foto} onChange={setFoto} />
                <Text className="text-xs text-muted-foreground">
                  Só troque se quiser mandar uma foto nova.
                </Text>
              </View>

              {erro ? <ErroCampo msg={erro} /> : null}

              <Button onPress={salvar} loading={submitting} disabled={submitting}>
                Salvar e enviar de novo
              </Button>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
