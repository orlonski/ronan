import { Pressable, Text, View } from "react-native";
import { Check, History, TriangleAlert } from "lucide-react-native";

/**
 * Sugestão de km do trajeto: mostra o que a frota já rodou nesse par de locais,
 * ANTES do motorista digitar. É informação de ajuda (um colega dizendo como é a
 * estrada), não alerta — por isso superfície neutra/positiva, nunca âmbar de
 * problema. O CTA "Usar X km" preenche o campo num toque.
 *
 * Aparece quando há amostra suficiente (o backend já resolveu a `efetiva` como
 * HISTORICO). Quando o km atual JÁ BATE com a sugestão (`confirmado`), não some:
 * vira uma linha compacta de confirmação ("rota já rodada N vezes"), sem o botão
 * — o sinal de "essa rota é conhecida" vale mesmo sem nada a corrigir.
 */
export function SugestaoKmHistorico({
  km,
  amostra,
  min,
  max,
  offline,
  confirmado,
  onUsar,
}: {
  km: number;
  amostra: number;
  /** Faixa observada (menor/maior km), pra dar noção de variação. */
  min?: number;
  max?: number;
  /** Sem sinal agora: o número vem do cache do que a frota já rodou. */
  offline?: boolean;
  /** O km atual já bate com a sugestão: mostra só a confirmação compacta. */
  confirmado?: boolean;
  onUsar: () => void;
}) {
  const kmFmt = formatKm(km);
  const temFaixa = min != null && max != null && Math.round(max) - Math.round(min) >= 1;

  // Km já bate: confirmação enxuta (uma linha), sem CTA. Só diz que a rota é
  // conhecida — o motorista vê que não está inventando um trajeto novo.
  if (confirmado) {
    return (
      <View className="mt-1 flex-row items-center gap-2 rounded-xl border border-success/30 bg-success/5 px-3 py-2">
        <Check size={16} color="#15803d" />
        <Text className="flex-1 text-sm font-medium text-foreground/80">
          Rota já rodada {amostra} {amostra === 1 ? "vez" : "vezes"} · ~{kmFmt} km
        </Text>
      </View>
    );
  }

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

/**
 * Aviso (âmbar) quando o km digitado sai fora do padrão do trajeto. Informa,
 * não trava — a rede de segurança (justificativa obrigatória) é acionada no
 * salvar, não aqui. Aparece embaixo do campo de km.
 */
export function AvisoKmForaDoPadrao({ referencia }: { referencia: number }) {
  return (
    <View className="mt-1 flex-row items-start gap-3 rounded-2xl border-2 border-warning/50 bg-warning/10 p-4">
      <TriangleAlert size={22} color="#b45309" style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text className="text-base font-bold text-foreground">
          Km fora do padrão desse trajeto
        </Text>
        <Text className="mt-1 text-sm font-medium text-warning-foreground">
          As outras viagens dessa rota deram ≈{formatKm(referencia)} km. Confira se
          o valor está certo — se rodou mais mesmo, você vai poder explicar o porquê.
        </Text>
      </View>
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
