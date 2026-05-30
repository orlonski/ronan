import { useEffect, useState } from "react";
import { router, Stack } from "expo-router";
import { MapPin, Shield } from "lucide-react-native";
import {
  ActivityIndicator,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { showAlert, showConfirm } from "@/lib/alert";
import {
  iniciarCapturaPeriodica,
  pararCapturaPeriodica,
  setConfigLocal,
} from "@/lib/posicao-periodica";
import {
  usePosicaoConfig,
  useSalvarPosicaoConfig,
  type PosicaoConfig,
} from "@/lib/queries";

const HORAS = Array.from({ length: 24 }, (_, i) => i);

export default function PerfilPosicaoScreen() {
  const cfg = usePosicaoConfig();
  const salvar = useSalvarPosicaoConfig();

  const [ativada, setAtivada] = useState(false);
  const [vinteQuatroHoras, setVinteQuatroHoras] = useState(true);
  const [horarioInicio, setHorarioInicio] = useState<number>(8);
  const [horarioFim, setHorarioFim] = useState<number>(18);

  useEffect(() => {
    if (!cfg.data) return;
    setAtivada(cfg.data.ativada);
    const temJanela =
      cfg.data.horarioInicio != null && cfg.data.horarioFim != null;
    if (temJanela) {
      // Motorista já configurou uma janela específica antes — usa ela.
      setVinteQuatroHoras(false);
      setHorarioInicio(cfg.data.horarioInicio!);
      setHorarioFim(cfg.data.horarioFim!);
    } else if (cfg.data.ativada) {
      // Já tá ativo e sem janela = motorista escolheu 24h. Mantém.
      setVinteQuatroHoras(true);
    } else {
      // Primeiro acesso (não-ativado, sem janela): sugere 8-18 como horário
      // comercial padrão. Motorista pode ligar 24h se preferir.
      setVinteQuatroHoras(false);
      setHorarioInicio(8);
      setHorarioFim(18);
    }
  }, [cfg.data]);

  async function persistir() {
    const payload: PosicaoConfig = {
      ativada,
      horarioInicio: vinteQuatroHoras || !ativada ? null : horarioInicio,
      horarioFim: vinteQuatroHoras || !ativada ? null : horarioFim,
    };
    try {
      await salvar.mutateAsync(payload);
      // Cache local: task background lê isso pra decidir se enfileira ou
      // não. Janela horária é avaliada client-side a cada captura.
      await setConfigLocal(payload);
      if (payload.ativada) {
        // Pre-prompt + permission + start task. Espelha o padrão do
        // tracking de viagem (prePromptBackgroundLocation em tracking.ts).
        const ok = await iniciarCapturaPeriodica();
        if (!ok) {
          // Usuário negou permissão. Reverte estado salvo pra desativado
          // pra UI não mentir.
          const desativado = {
            ativada: false,
            horarioInicio: null,
            horarioFim: null,
          };
          await salvar.mutateAsync(desativado);
          await setConfigLocal(desativado);
          setAtivada(false);
          await showAlert({
            title: "Permissão não concedida",
            message:
              "Sem permissão de localização em segundo plano, a captura periódica não funciona. Configuração revertida.",
            variant: "warning",
          });
          return;
        }
      } else {
        await pararCapturaPeriodica();
      }
      await showAlert({
        title: "Salvo",
        message: payload.ativada
          ? "Captura periódica ativada."
          : "Captura periódica desativada.",
      });
    } catch (err) {
      await showAlert({
        title: "Erro ao salvar",
        message: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  if (cfg.isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Compartilhar posição" />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
      >
        <Card>
          <View className="mb-3 flex-row items-center gap-2">
            <Shield size={18} color="#0f172a" />
            <Text className="text-base font-bold text-foreground">
              Como funciona
            </Text>
          </View>
          <Text className="text-sm leading-5 text-muted-foreground">
            Quando você ativa, o app envia sua posição GPS a cada ~15 minutos
            pra empresa. Serve pro controle de frota — admin vê no mapa onde
            cada motorista está. Você pode desativar a qualquer momento. As
            posições antigas são apagadas automaticamente depois de 90 dias.
          </Text>
        </Card>

        <Card>
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-base font-bold text-foreground">
                Permitir compartilhamento
              </Text>
              <Text className="mt-0.5 text-sm text-muted-foreground">
                {ativada ? "Ativado" : "Desativado"}
              </Text>
            </View>
            <Switch
              value={ativada}
              onValueChange={setAtivada}
              trackColor={{ false: "#cbd5e1", true: "#22c55e" }}
            />
          </View>
        </Card>

        {ativada && (
          <Card>
            <View className="mb-3 flex-row items-center gap-2">
              <MapPin size={18} color="#0f172a" />
              <Text className="text-base font-bold text-foreground">
                Quando capturar
              </Text>
            </View>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="flex-1 text-sm text-foreground">
                24 horas por dia
              </Text>
              <Switch
                value={vinteQuatroHoras}
                onValueChange={setVinteQuatroHoras}
                trackColor={{ false: "#cbd5e1", true: "#22c55e" }}
              />
            </View>
            {!vinteQuatroHoras && (
              <View className="gap-3">
                <Text className="text-xs text-muted-foreground">
                  Janela horária (horário local). Fora dessa janela, nenhuma
                  posição é capturada.
                </Text>
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="mb-1 text-xs font-medium text-muted-foreground">
                      Início
                    </Text>
                    <HoraSelector value={horarioInicio} onChange={setHorarioInicio} />
                  </View>
                  <View className="flex-1">
                    <Text className="mb-1 text-xs font-medium text-muted-foreground">
                      Fim
                    </Text>
                    <HoraSelector value={horarioFim} onChange={setHorarioFim} />
                  </View>
                </View>
              </View>
            )}
          </Card>
        )}

        <Button onPress={persistir} loading={salvar.isPending} size="lg">
          <Text className="text-base font-bold text-primary-foreground">
            Salvar configuração
          </Text>
        </Button>

        <Button variant="outline" onPress={() => router.back()}>
          <Text className="text-base font-medium text-foreground">Voltar</Text>
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

function HoraSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (h: number) => void;
}) {
  // Simples: + / - com cap em 0-23. Evita modal/picker pesado.
  return (
    <View className="flex-row items-center justify-between rounded-lg border border-border bg-background p-2">
      <Button
        variant="ghost"
        size="sm"
        onPress={() => onChange((value - 1 + 24) % 24)}
      >
        <Text className="text-base font-bold text-foreground">-</Text>
      </Button>
      <Text
        className="text-lg font-bold text-foreground"
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {String(value).padStart(2, "0")}h
      </Text>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => onChange((value + 1) % 24)}
      >
        <Text className="text-base font-bold text-foreground">+</Text>
      </Button>
    </View>
  );
}
// Suppress unused HORAS warning
void HORAS;
