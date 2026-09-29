import { Text, View } from "react-native";
import { router } from "expo-router";
import { CalendarClock } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { useLembreteLancamento } from "@/lib/lembrete-lancamento";

/**
 * Card discreto da home: "Você está há N dias sem lançar viagem…".
 *
 * Sem Modal e sem permissão do SO — é só um cartão na lista. "Lançar viagem" é a
 * ação de rotina (laranja) e abre o lançamento normal; "Agora não" (contorno) some
 * só por hoje. O motorista é parceiro autônomo: o tom informa, não cobra.
 */
export function LembreteLancamento() {
  const { visivel, texto, dispensar } = useLembreteLancamento();
  if (!visivel) return null;

  return (
    <View className="gap-3 rounded-2xl border-2 border-border bg-card p-4">
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-secondary">
          <CalendarClock size={20} color="#13316b" />
        </View>
        <Text className="flex-1 text-base text-foreground">{texto}</Text>
      </View>
      <View className="flex-row gap-3">
        <Button variant="outline" size="sm" className="flex-1" onPress={dispensar}>
          Agora não
        </Button>
        <Button
          variant="default"
          size="sm"
          className="flex-1"
          onPress={() => router.push("/nova-viagem")}
        >
          Lançar viagem
        </Button>
      </View>
    </View>
  );
}
