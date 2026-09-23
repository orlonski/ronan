import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Receipt, Truck } from "lucide-react-native";
import { HistoricoPessoal } from "@/components/historico-pessoal";

/**
 * MEU CADERNO: o que ele ganha e gasta por conta própria, fora da empresa.
 *
 * Aba, não botão na home (decisão do dono, 22/09/2026). Era um card no fim da
 * tela inicial, misturado com os lançamentos da empresa — e o caderno não é
 * lançamento da empresa: é dele, a empresa não vê e não libera. Coisa que se
 * usa todo dia merece lugar próprio, como o Ponto.
 *
 * Quem não tem empresa não vê esta aba: pra ele o Histórico já É o caderno, e
 * o Início já tem os botões de anotar.
 */
export default function CadernoScreen() {
  return (
    <HistoricoPessoal
      titulo="Meu caderno"
      acoes={
        <View className="flex-row gap-3">
          <Anotar
            icone={<Receipt size={22} color="#13316b" strokeWidth={2.5} />}
            titulo="Anotar gasto"
            onPress={() => router.push("/meus-gastos")}
          />
          <Anotar
            icone={<Truck size={22} color="#13316b" strokeWidth={2.5} />}
            titulo="Anotar frete"
            onPress={() => router.push("/novo-frete")}
          />
        </View>
      }
    />
  );
}

function Anotar({ icone, titulo, onPress }: { icone: React.ReactNode; titulo: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 flex-row items-center gap-3 rounded-2xl border-2 border-border bg-card p-4 active:opacity-75"
    >
      <View className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary">{icone}</View>
      <Text className="flex-1 text-base font-bold text-foreground">{titulo}</Text>
    </Pressable>
  );
}
