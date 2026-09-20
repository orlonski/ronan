import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { api } from "@/lib/api";
import { showAlert } from "@/lib/alert";
import { useCatalogoPonto } from "@/lib/queries";
import { hojeISO } from "@/lib/datetime";

/**
 * PEDIR CORREÇÃO de um dia.
 *
 * ⚠️ Ele PEDE, não corrige. A decisão é do escritório, com autor e data — e o
 * registro original nunca é apagado, nem por ele nem por eles. É isso que faz
 * o documento valer alguma coisa depois.
 *
 * O motivo escrito é obrigatório dos dois lados, mesma doutrina da alteração
 * de km: mexer no registro de alguém sem justificativa escrita não pode.
 */
export default function CorrigirPontoScreen() {
  const router = useRouter();
  const { data: catalogo } = useCatalogoPonto();
  const [dia, setDia] = useState(hojeISO());
  const [hora, setHora] = useState("");
  const [motivoCodigo, setMotivoCodigo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  const motivos = catalogo?.motivos ?? [];
  const podeEnviar =
    /^\d{4}-\d{2}-\d{2}$/.test(dia) &&
    /^\d{2}:\d{2}$/.test(hora) &&
    motivoCodigo.length > 0 &&
    motivo.trim().length >= 3;

  async function enviar() {
    setEnviando(true);
    try {
      await api.post("/m/ponto/correcoes", {
        dia,
        tipo: "INCLUSAO",
        instantePretendido: new Date(`${dia}T${hora}:00-03:00`).toISOString(),
        motivoCodigo,
        motivo: motivo.trim(),
      });
      void showAlert({
        title: "Pedido enviado",
        message: "O escritório vai analisar. Você vê o resultado no seu espelho.",
      });
      router.back();
    } catch {
      void showAlert({
        title: "Não consegui enviar",
        message: "Precisa de internet pra isso. Tente de novo quando tiver sinal.",
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="bg-brand px-5 pb-6 pt-14">
        <View className="flex-row items-start justify-between">
          <Text className="flex-1 text-2xl font-bold text-white">Pedir correção</Text>
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
        <Text className="text-base text-foreground">
          Esqueceu de bater, ou bateu na hora errada? Diga o dia e a hora que deveria ter sido
          registrada. Quem decide é o escritório.
        </Text>

        <View className="gap-1">
          <Text className="text-base font-semibold text-foreground">Que dia</Text>
          <TextInput
            className="h-14 rounded-xl border-2 border-border px-4 text-lg text-foreground"
            placeholder="AAAA-MM-DD"
            value={dia}
            onChangeText={setDia}
          />
        </View>

        <View className="gap-1">
          <Text className="text-base font-semibold text-foreground">Que horas</Text>
          <TextInput
            className="h-14 rounded-xl border-2 border-border px-4 text-lg text-foreground"
            placeholder="07:30"
            keyboardType="numbers-and-punctuation"
            value={hora}
            onChangeText={setHora}
          />
        </View>

        <View className="gap-2">
          <Text className="text-base font-semibold text-foreground">O que aconteceu</Text>
          {motivos.map((m) => (
            <Pressable
              key={m.codigo}
              accessibilityRole="button"
              onPress={() => setMotivoCodigo(m.codigo)}
              className={`rounded-xl border-2 p-4 ${
                motivoCodigo === m.codigo ? "border-brand bg-brand/10" : "border-border"
              }`}
            >
              <Text className="text-base font-medium text-foreground">{m.descricao}</Text>
            </Pressable>
          ))}
        </View>

        <View className="gap-1">
          <Text className="text-base font-semibold text-foreground">Explique com suas palavras</Text>
          <TextInput
            className="min-h-24 rounded-xl border-2 border-border p-3 text-base text-foreground"
            multiline
            placeholder="Ex: o celular ficou sem bateria e eu só vi depois"
            value={motivo}
            onChangeText={setMotivo}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!podeEnviar || enviando}
          onPress={() => void enviar()}
          className={`h-16 items-center justify-center rounded-2xl ${
            podeEnviar ? "bg-success" : "bg-muted"
          }`}
        >
          <Text
            className={`text-xl font-bold ${
              podeEnviar ? "text-success-foreground" : "text-muted-foreground"
            }`}
          >
            {enviando ? "Enviando…" : "Enviar pedido"}
          </Text>
        </Pressable>

        <Text className="pb-4 text-center text-xs text-muted-foreground">
          Seu registro original continua lá — a correção é uma linha nova, e fica escrito quem
          pediu, quem decidiu e por quê.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
