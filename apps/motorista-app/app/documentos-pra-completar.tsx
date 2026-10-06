import { useMemo } from "react";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Clock, FileCheck } from "lucide-react-native";
import { ScreenHeader } from "@/components/screen-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { CartaoEtapa } from "@/components/etapas/cartao-etapas-viagem";
import { etapasAbertas, useEstadoEtapas, type EtapaAberta } from "@/lib/etapas-local";

function quando(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Duas portas, uma tela:
 *
 * - sem parâmetro — "Documentos pra completar" (o bloco da home leva pra cá):
 *   um cartão por formulário que ainda tem algo faltando, por viagem, a mais
 *   recente em cima;
 * - `?viagemClientId=` — "Agora os documentos", logo depois de "Lançar viagem
 *   feita": TODOS os formulários daquela viagem, com "Fazer depois".
 */
export default function DocumentosPraCompletar() {
  const { viagemClientId } = useLocalSearchParams<{ viagemClientId?: string }>();
  const estado = useEstadoEtapas();
  const daViagem = !!viagemClientId;

  const porViagem = useMemo(() => {
    if (!estado) return [];
    const grupos = new Map<string, EtapaAberta[]>();
    for (const e of etapasAbertas(estado, viagemClientId || undefined)) {
      if (!daViagem) {
        if (e.contagem.faltando.length === 0) continue;
        if (e.modelo.momento === "AVULSA" && !e.viagem.finalizadaEm) continue;
      }
      const l = grupos.get(e.viagem.viagemClientId) ?? [];
      l.push(e);
      grupos.set(e.viagem.viagemClientId, l);
    }
    return [...grupos.values()].sort((a, b) =>
      (b[0]!.viagem.iniciadaEm ?? "").localeCompare(a[0]!.viagem.iniciadaEm ?? ""),
    );
  }, [estado, viagemClientId, daViagem]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title={daViagem ? "Agora os documentos" : "Documentos pra completar"} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 20 }}>
        {daViagem ? (
          <Text className="text-base text-foreground">
            Viagem guardada. Se tiver os papéis dela à mão, já pode mandar — ou faça depois: eles
            ficam esperando na tela inicial.
          </Text>
        ) : null}
        {estado && porViagem.length === 0 ? (
          <EmptyState
            icon={FileCheck}
            title="Nada faltando"
            description="Os documentos das suas viagens estão em dia."
          />
        ) : null}
        {porViagem.map((etapas) => {
          const v = etapas[0]!.viagem;
          return (
            <View key={v.viagemClientId} className="gap-3">
              <Text className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                {[v.placa, v.rotulo, quando(v.iniciadaEm)].filter(Boolean).join(" · ")}
              </Text>
              {etapas.map((e) => (
                <CartaoEtapa key={e.modelo.id} e={e} />
              ))}
            </View>
          );
        })}
        {daViagem ? (
          <Button variant="outline" onPress={() => router.back()}>
            <Clock size={20} color="#0f172a" />
            <Text className="text-base font-semibold text-foreground">Fazer depois</Text>
          </Button>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
