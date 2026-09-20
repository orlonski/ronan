import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { useMeusDiasObra } from "@/lib/queries";

/**
 * Quantos dias na obra eu já fiz neste mês.
 *
 * Pra quem é pago por diária essa é a pergunta do mês inteiro, e até agora só
 * o escritório tinha a resposta — ele contava de cabeça. Ter o número do lado
 * dele é o que torna a conferência do dia 20 uma conversa entre duas contas, e
 * não uma contra a memória.
 *
 * NÃO mostra dinheiro, de propósito. Valor é conversa do acerto; misturar
 * aqui transformaria uma tela de conferência numa tela de cobrança, e o
 * primeiro número que ele veria de manhã seria quanto tem a receber. Existe a
 * flag `podeVerValorDiaria` pra quando o dono decidir ligar.
 *
 * O desenho segue o do resto do mensal: número grande primeiro, cor antes de
 * texto, e nada que exija ler uma frase pra entender.
 */

const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function rotuloMes(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  return `${NOMES_MES[(m ?? 1) - 1]} de ${a}`;
}

function mesVizinho(ym: string, passos: number): string {
  const [a, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(a!, (m ?? 1) - 1 + passos, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function MeusDiasObraScreen() {
  const router = useRouter();
  const [mes, setMes] = useState(mesAtual());
  const { data, isLoading } = useMeusDiasObra(mes);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="bg-brand px-5 pb-6 pt-14">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="text-2xl font-bold text-white">Meus dias na obra</Text>
            {data?.obras.length ? (
              <Text className="mt-0.5 text-base text-white/80" numberOfLines={1}>
                {data.obras.join(" · ")}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={() => router.back()}
            className="p-2"
          >
            <X size={28} color="#fff" />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerClassName="p-4 gap-4">
        {/* Navegação de mês com alvos grandes: seta pequena é o tipo de coisa
            que este público erra três vezes antes de acertar. */}
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mês anterior"
            onPress={() => setMes((m) => mesVizinho(m, -1))}
            className="rounded-2xl border-2 border-border p-4"
          >
            <ChevronLeft size={28} />
          </Pressable>
          <Text className="text-xl font-semibold capitalize text-foreground">
            {rotuloMes(mes)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Próximo mês"
            disabled={mes >= mesAtual()}
            onPress={() => setMes((m) => mesVizinho(m, 1))}
            className={`rounded-2xl border-2 border-border p-4 ${mes >= mesAtual() ? "opacity-30" : ""}`}
          >
            <ChevronRight size={28} />
          </Pressable>
        </View>

        {/* O número é a tela. Quem abre isso quer um número, não uma tabela. */}
        <View className="items-center rounded-3xl bg-emerald-600 py-8">
          <Text className="text-7xl font-bold text-white">{data?.total ?? 0}</Text>
          <Text className="mt-1 text-2xl font-semibold text-white">
            {data?.total === 1 ? "dia na obra" : "dias na obra"}
          </Text>
        </View>

        {isLoading && !data ? (
          <Text className="text-center text-base text-muted-foreground">Carregando…</Text>
        ) : null}

        {data && data.dias.length > 0 && (
          <>
            <View className="flex-row flex-wrap gap-2">
              {data.dias.map((d) => {
                const numero = d.data.slice(-2);
                if (d.marcado) {
                  return (
                    <View
                      key={d.data}
                      className="h-14 w-14 items-center justify-center rounded-xl bg-emerald-600"
                    >
                      <Text className="text-xl font-bold text-white">{numero}</Text>
                    </View>
                  );
                }
                // Dia futuro é cinza claro: ainda não aconteceu, então não
                // pode parecer cobrança. Dia passado sem marca fica com
                // contorno âmbar — visível, sem acusar.
                return (
                  <View
                    key={d.data}
                    className={`h-14 w-14 items-center justify-center rounded-xl border-2 ${
                      d.futuro ? "border-border" : "border-amber-500/60"
                    }`}
                  >
                    <Text
                      className={`text-xl font-semibold ${
                        d.futuro ? "text-muted-foreground/50" : "text-amber-700"
                      }`}
                    >
                      {numero}
                    </Text>
                  </View>
                );
              })}
            </View>

            <View className="gap-2 rounded-2xl border border-border p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-6 w-6 rounded-md bg-emerald-600" />
                <Text className="text-base text-foreground">Você marcou</Text>
              </View>
              <View className="flex-row items-center gap-3">
                <View className="h-6 w-6 rounded-md border-2 border-amber-500/60" />
                <Text className="text-base text-foreground">Sem marcar</Text>
              </View>
            </View>

            {/* A saída pra quem viu um dia errado. Sem isto a tela mostra o
                problema e não diz o que fazer com ele. */}
            <Text className="pb-4 text-center text-base text-muted-foreground">
              Faltou algum dia que você trabalhou? Avise o escritório.
            </Text>
          </>
        )}

        {data && data.dias.length === 0 && (
          <Text className="text-center text-base text-muted-foreground">
            Você não estava em obra nenhuma neste mês.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
