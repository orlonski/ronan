import { useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react-native";
import { api } from "@/lib/api";
import { showAlert } from "@/lib/alert";
import { DateField } from "@/components/ui/date-field";
import { HoraField } from "@/components/ui/hora-field";
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
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function nomeDoMes(ymd: string): string {
  const m = Number(ymd.split("-")[1]);
  return MESES[(m || 1) - 1] ?? "";
}

export default function CorrigirPontoScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: catalogo } = useCatalogoPonto();
  // Chegando pelo toque num dia do espelho, a data já vem escolhida — é o
  // caminho natural ("esse dia aqui está errado") e evita ela procurar a
  // data de novo no calendário.
  const { dia: diaParam } = useLocalSearchParams<{ dia?: string }>();
  const [dia, setDia] = useState(
    typeof diaParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(diaParam) ? diaParam : hojeISO(),
  );
  /** ISO completo do instante escolhido — o `HoraField` devolve assim. */
  const [instante, setInstante] = useState("");
  const [motivoCodigo, setMotivoCodigo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const yDoTexto = useRef(0);

  const motivos = catalogo?.motivos ?? [];
  const escolhido = motivos.find((m) => m.codigo === motivoCodigo);

  /**
   * O texto livre só é OBRIGATÓRIO quando o motivo escolhido não diz nada
   * sozinho ("Outro motivo").
   *
   * Quem escolheu "Esqueci de registrar" já escreveu o motivo — pedir que
   * digite de novo é cobrar redação de quem tem dificuldade de leitura, e o
   * resultado previsível é um "esqueci" digitado no braço pra destravar o
   * botão, que não acrescenta nada ao documento. Nos outros casos o campo
   * fica, como detalhe opcional.
   */
  const exigeTexto = motivoCodigo === "OUTRO";
  const podeEnviar =
    /^\d{4}-\d{2}-\d{2}$/.test(dia) &&
    instante.length > 0 &&
    motivoCodigo.length > 0 &&
    (!exigeTexto || motivo.trim().length >= 3);

  async function enviar() {
    setEnviando(true);
    try {
      await api.post("/m/ponto/correcoes", {
        dia,
        tipo: "INCLUSAO",
        instantePretendido: instante,
        motivoCodigo,
        // O servidor exige motivo escrito (mesma doutrina da alteração de
        // km). Quando ela não digitou nada, o que vai é a descrição que ela
        // ESCOLHEU — continua sendo uma razão em português no documento, não
        // um código que só o sistema entende.
        motivo: motivo.trim() || escolhido?.descricao || "Sem detalhe",
      });
      // O espelho do mês do DIA CORRIGIDO — que pode não ser o mês atual.
      // Sem invalidar, ele volta pra tela anterior e não vê o próprio pedido.
      await qc.invalidateQueries({ queryKey: ["ponto-espelho"] });
      void showAlert({
        title: "Pedido enviado",
        message: `O escritório vai analisar. Você acompanha em "Meu espelho", no mês de ${nomeDoMes(dia)} — o dia ${dia.slice(-2)} já aparece marcado como pedido.`,
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

      {/* ⚠️ `behavior="padding"` nas DUAS plataformas: no Android com
          edge-to-edge (SDK 54) a janela não redimensiona sozinha, e sem isto
          o teclado cobre o campo — a pessoa digita sem ver o que escreveu.
          Lição já paga em outras telas deste app. */}
      <KeyboardAvoidingView behavior="padding" className="flex-1" keyboardVerticalOffset={8}>
      <ScrollView
        ref={scroll}
        contentContainerClassName="p-4 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-base text-foreground">
          Esqueceu de bater, ou bateu na hora errada? Diga o dia e a hora que deveria ter sido
          registrada. Quem decide é o escritório.
        </Text>

        {/* ⚠️ Picker nativo, nunca campo de texto. Eu tinha deixado o motorista
            DIGITAR "AAAA-MM-DD" e "07:30" — pedir formato de máquina a quem
            tem dificuldade de leitura é garantir erro de digitação numa tela
            que existe pra corrigir erro. Os dois componentes já existiam no
            app; foi preguiça minha. */}
        <View className="gap-1">
          <Text className="text-base font-semibold text-foreground">Que dia</Text>
          <DateField value={dia} onChange={setDia} />
        </View>

        <View className="gap-1">
          <Text className="text-base font-semibold text-foreground">Que horas</Text>
          <HoraField value={instante} data={dia} onChange={setInstante} />
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

        <View className="gap-1" onLayout={(e) => (yDoTexto.current = e.nativeEvent.layout.y)}>
          <Text className="text-base font-semibold text-foreground">
            {exigeTexto ? "Explique o que aconteceu" : "Quer detalhar? (opcional)"}
          </Text>
          <TextInput
            className="min-h-24 rounded-xl border-2 border-border p-3 text-base text-foreground"
            multiline
            placeholder="Ex: o celular ficou sem bateria e eu só vi depois"
            value={motivo}
            onChangeText={setMotivo}
            // Rolar até o campo ao focar: o `padding` abre espaço, mas quem
            // leva a pessoa até lá é isto.
            onFocus={() =>
              setTimeout(() => scroll.current?.scrollTo({ y: yDoTexto.current, animated: true }), 250)
            }
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
