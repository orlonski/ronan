import { useMemo, useState } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Clock } from "lucide-react-native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { ErroCampo, useValidacaoGuiada } from "@/components/validacao-guiada";
import { ViagemAguardandoInfo } from "@/components/viagem-aguardando-info";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showAlert } from "@/lib/alert";
import {
  fmtHoraBR,
  isoDeDataHoraBR,
  minutosEntre,
  UM_DIA_MS,
} from "@/lib/datetime";
import { formatarDuracao } from "@ronan/shared-types";
import { useDiariasAbertas, useEncerrarDiaria } from "@/lib/queries";

/**
 * Encerra uma diária aberta (AGUARDANDO_SAIDA): o motorista marcou a entrada e
 * agora saiu. Espelho de completar-peso.tsx — tela enxuta, uma decisão só.
 *
 * Dois caminhos, de propósito: "Saí agora" carimba o relógio com um toque, e o
 * campo de hora atende quem só lembrou de encerrar depois.
 */
export default function EncerrarDiaria() {
  const { viagemId } = useLocalSearchParams<{ viagemId: string }>();
  const abertas = useDiariasAbertas();
  const encerrarDiaria = useEncerrarDiaria();

  const viagem = useMemo(
    () => abertas.data?.find((v) => v.id === viagemId),
    [abertas.data, viagemId],
  );

  const [saidaEm, setSaidaEm] = useState("");
  const [horaTexto, setHoraTexto] = useState("");
  const [editando, setEditando] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const val = useValidacaoGuiada();

  const entradaEm = viagem?.entradaEm ?? null;

  const duracaoLabel = useMemo(() => {
    if (!entradaEm || !saidaEm) return "—";
    const min = minutosEntre(entradaEm, saidaEm);
    if (min == null || min <= 0) return "confira a hora";
    return formatarDuracao(min);
  }, [entradaEm, saidaEm]);

  /**
   * A hora digitada é do dia da ENTRADA. Se der um instante anterior a ela, a
   * diária virou a noite — empurra um dia em vez de recusar um lançamento que
   * está certo.
   */
  function aplicarHora(valor: string) {
    const limpo = valor.replace(/[^\d:]/g, "");
    setHoraTexto(limpo);
    if (!entradaEm) return;
    const diaDaEntrada = new Date(
      new Date(entradaEm).getTime() - 3 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    let iso = isoDeDataHoraBR(diaDaEntrada, limpo);
    if (!iso) return;
    const min = minutosEntre(entradaEm, iso);
    if (min != null && min <= 0) {
      iso = new Date(new Date(iso).getTime() + UM_DIA_MS).toISOString();
    }
    val.limpar();
    setSaidaEm(iso);
  }

  async function salvar() {
    setErro(null);
    if (!viagemId) return;
    if (!saidaEm) {
      return void val.apontar("saidaEm", "Marque a hora que você saiu");
    }
    if (entradaEm) {
      const min = minutosEntre(entradaEm, saidaEm);
      if (min == null || min <= 0) {
        return void val.apontar("saidaEm", "A saída tem que ser depois da entrada");
      }
    }
    val.limpar();
    setSubmitting(true);
    try {
      await encerrarDiaria({ viagemId, saidaEm });
      const restantes = (abertas.data ?? []).filter((v) => v.id !== viagemId).length;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await showAlert({
        title: "Diária encerrada!",
        message:
          restantes > 0
            ? `Pronto — ${duracaoLabel} registrados. Ainda ${
                restantes === 1 ? "falta 1 diária aberta" : `faltam ${restantes} diárias abertas`
              }.`
            : `Pronto — ${duracaoLabel} registrados. Se estiver sem sinal, envia sozinho quando voltar.`,
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
      <ScreenHeader title="Encerrar diária" />
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          ref={val.scrollRef}
          className="flex-1"
          contentContainerClassName="p-4 gap-5"
          keyboardShouldPersistTaps="handled"
        >
          {abertas.isLoading && !viagem ? (
            <View className="items-center py-16">
              <ActivityIndicator />
            </View>
          ) : !viagem ? (
            <View className="gap-3 rounded-2xl bg-muted p-5">
              <Text className="text-lg font-bold text-foreground">
                Diária não encontrada
              </Text>
              <Text className="text-base text-muted-foreground">
                Ela pode já ter sido encerrada ou o app está sem sinal. Volte e
                tente de novo.
              </Text>
              <Button variant="outline" onPress={() => router.back()}>
                Voltar
              </Button>
            </View>
          ) : (
            <>
              <View className="flex-row items-start gap-3 rounded-2xl bg-violet-500/10 p-4">
                <Clock size={24} color="#7c3aed" style={{ marginTop: 2 }} />
                <ViagemAguardandoInfo viagem={viagem} />
              </View>

              <View className="flex-row items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
                <Text className="text-sm text-muted-foreground">Você entrou às</Text>
                <Text className="text-lg font-bold text-foreground">
                  {fmtHoraBR(entradaEm)}
                </Text>
              </View>

              <View onLayout={val.onLayoutCampo("saidaEm")} className="gap-2">
                <Label error={!!val.erroDe("saidaEm")}>Hora que você saiu</Label>
                <View className="flex-row items-center gap-2">
                  <Button
                    variant={saidaEm ? "outline" : "default"}
                    className={saidaEm ? "" : "bg-emerald-600"}
                    onPress={() => {
                      val.limpar();
                      setSaidaEm(new Date().toISOString());
                      setHoraTexto("");
                      setEditando(false);
                    }}
                  >
                    <Clock size={18} color={saidaEm ? "#0f172a" : "white"} />
                    <Text
                      className={`ml-1 font-semibold ${
                        saidaEm ? "text-foreground" : "text-white"
                      }`}
                    >
                      Saí agora
                    </Text>
                  </Button>
                  <View className="flex-1">
                    <Input
                      value={editando ? horaTexto : saidaEm ? fmtHoraBR(saidaEm) : ""}
                      onFocus={() => {
                        setEditando(true);
                        setHoraTexto(saidaEm ? fmtHoraBR(saidaEm) : "");
                      }}
                      onBlur={() => setEditando(false)}
                      onChangeText={aplicarHora}
                      keyboardType="numbers-and-punctuation"
                      placeholder="00:00"
                      maxLength={5}
                      error={!!val.erroDe("saidaEm")}
                    />
                  </View>
                </View>
                {val.erroDe("saidaEm") ? (
                  <ErroCampo msg={val.erroDe("saidaEm")!} />
                ) : (
                  <Text className="text-xs text-muted-foreground">
                    Toque em “Saí agora” ou digite a hora, se já faz um tempo.
                  </Text>
                )}
              </View>

              <View className="flex-row items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
                <Text className="text-sm text-muted-foreground">
                  Tempo à disposição
                </Text>
                <Text className="text-lg font-bold text-foreground">
                  {duracaoLabel}
                </Text>
              </View>

              {erro ? <ErroCampo msg={erro} /> : null}

              <Button onPress={salvar} loading={submitting} disabled={submitting}>
                Encerrar diária
              </Button>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
