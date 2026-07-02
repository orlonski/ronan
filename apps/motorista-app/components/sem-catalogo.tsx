import { Text, View } from "react-native";
import { CloudOff } from "lucide-react-native";
import { Button } from "@/components/ui/button";

/**
 * Plano B quando o app não tem os dados-base (clientes/materiais/locais) — ex:
 * motorista logou e ficou sem sinal antes do download automático terminar.
 * Grande e claro, com botão "Baixar agora" (aoBaixar = cat.refetch()).
 */
export function SemCatalogo({
  carregando,
  aoBaixar,
}: {
  carregando: boolean;
  aoBaixar: () => void;
}) {
  return (
    <View className="m-4 gap-3 rounded-2xl border-2 border-warning/50 bg-warning/10 p-5">
      <View className="flex-row items-center gap-2">
        <CloudOff size={22} color="#b45309" />
        <Text className="text-lg font-bold text-foreground">Precisa baixar os dados</Text>
      </View>
      <Text className="text-base text-muted-foreground">
        Pra cadastrar viagem, o app baixa clientes, materiais e locais uma vez. Conecte na
        internet e toque em Baixar.
      </Text>
      <Button size="lg" className="h-16" onPress={aoBaixar} loading={carregando}>
        <Text className="text-base font-bold text-primary-foreground">
          {carregando ? "Baixando…" : "Baixar agora"}
        </Text>
      </Button>
    </View>
  );
}
