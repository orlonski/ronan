import { Pressable, Text, View } from "react-native";
import { History } from "lucide-react-native";

/**
 * Sugestão de km do trajeto: mostra o que a frota já rodou nesse par de locais,
 * ANTES do motorista digitar. É informação de ajuda (um colega dizendo como é a
 * estrada), não alerta — por isso superfície neutra/positiva, nunca âmbar de
 * problema. O CTA "Usar X km" preenche o campo num toque.
 *
 * Aparece só quando há amostra suficiente (o backend já resolveu a `efetiva`
 * como HISTORICO). Some quando o km atual já bate com a sugestão (não repete o
 * óbvio) — controlado pela tela.
 */
export function SugestaoKmHistorico({
  km,
  amostra,
  min,
  max,
  offline,
  onUsar,
}: {
  km: number;
  amostra: number;
  /** Faixa observada (menor/maior km), pra dar noção de variação. */
  min?: number;
  max?: number;
  /** Sem sinal agora: o número vem do cache do que a frota já rodou. */
  offline?: boolean;
  onUsar: () => void;
}) {
  const kmFmt = formatKm(km);
  const temFaixa = min != null && max != null && Math.round(max) - Math.round(min) >= 1;
  return (
    <View className="mt-1 rounded-2xl border-2 border-success/40 bg-success/10 p-4">
      <View className="flex-row items-start gap-3">
        <History size={22} color="#15803d" style={{ marginTop: 1 }} />
        <View className="flex-1">
          <Text className="text-base font-bold text-foreground">
            Essa rota já foi rodada {amostra} {amostra === 1 ? "vez" : "vezes"}
          </Text>
          <Text className="mt-1 text-sm font-medium text-foreground/80">
            {offline
              ? `Sem internet agora — pelas viagens que já foram feitas nessa rota, quase sempre deu ≈${kmFmt} km`
              : `Quase sempre deu ≈${kmFmt} km`}
            {temFaixa ? ` (de ${formatKm(min!)} a ${formatKm(max!)})` : ""}.
          </Text>
        </View>
      </View>
      <Pressable
        onPress={onUsar}
        className="mt-3 items-center rounded-xl border-2 border-success/50 bg-success/15 py-2.5 active:opacity-70"
      >
        <Text className="text-base font-bold text-success">Usar {kmFmt} km</Text>
      </Pressable>
    </View>
  );
}

/** Km amigável: sem casas quando inteiro, 1 casa quando tem fração. */
function formatKm(n: number): string {
  const arred = Math.round(n * 10) / 10;
  return Number.isInteger(arred)
    ? String(arred)
    : arred.toFixed(1).replace(".", ",");
}
