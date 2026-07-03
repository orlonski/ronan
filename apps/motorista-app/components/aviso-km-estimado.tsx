import { Text, View } from "react-native";
import { CloudOff } from "lucide-react-native";

/**
 * Aviso GRANDE de km estimado sem sinal. A rota veio do haversine (linha reta ×
 * 1,3) porque o OSRM não respondeu — o número pode não bater com o real. Some
 * quando há cálculo preciso. Copy em linguagem de motorista.
 *
 * Renderizado quando `rota.fonte === "estimado_haversine"` nas telas de nova
 * viagem e finalizar. Substitui o textinho `text-xs` que passava despercebido.
 */
export function AvisoKmEstimado({ km }: { km: string }) {
  return (
    <View className="mt-1 flex-row items-start gap-3 rounded-2xl border-2 border-warning/50 bg-warning/10 p-4">
      <CloudOff size={24} color="#b45309" style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text className="text-base font-bold text-foreground">
          Sem sinal aqui — esse km é só uma estimativa
        </Text>
        <Text className="mt-1 text-sm font-medium text-warning-foreground">
          Calculei ≈{km} km em linha reta (por cima), pode não bater com o real da
          estrada. Assim que você pegar sinal, a gente acerta sozinho e te avisa.
        </Text>
      </View>
    </View>
  );
}
