import { Text, View } from "react-native";
import { CloudOff } from "lucide-react-native";

/**
 * Aviso GRANDE de km SEM INTERNET. Dois casos, ambos offline (o OSRM não
 * respondeu), com copy própria pra motorista:
 *  - "estimado_haversine": km em linha reta × 1,3 (chute por cima).
 *  - "cache_local": km de um cálculo anterior dessa mesma rota, salvo no aparelho.
 *
 * Sempre âmbar e destacado (informação nunca é demais). Some quando o cálculo é
 * fresco (osrm/cache_server = teve internet). Renderizado em linha inteira nas
 * telas de nova viagem e finalizar.
 */
export function AvisoKmEstimado({
  km,
  fonte,
}: {
  km: string;
  /** "estimado_haversine" (linha reta) ou "cache_local" (cache do aparelho). */
  fonte?: "estimado_haversine" | "cache_local";
}) {
  const cache = fonte === "cache_local";
  return (
    <View className="mt-1 flex-row items-start gap-3 rounded-2xl border-2 border-warning/50 bg-warning/10 p-4">
      <CloudOff size={24} color="#b45309" style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text className="text-base font-bold text-foreground">
          {cache
            ? "Sem internet — usando um cálculo anterior"
            : "Sem internet — esse km é só uma estimativa"}
        </Text>
        <Text className="mt-1 text-sm font-medium text-warning-foreground">
          {cache
            ? `Sem sinal agora: peguei ≈${km} km de um cálculo dessa mesma rota que ficou salvo no aparelho. Quando você pegar sinal, a gente confere pela estrada certa e te avisa.`
            : `Calculei ≈${km} km em linha reta (por cima), pode não bater com o real da estrada. Assim que você pegar sinal, a gente acerta sozinho e te avisa.`}
        </Text>
      </View>
    </View>
  );
}
