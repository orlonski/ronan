import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Check } from "lucide-react-native";
import type { RotaOption } from "@/lib/queries";
import { RotasMapa, corDaRota } from "./seletor-rotas";

/**
 * Escolha "segui direto" vs "precisei voltar no retorno". Quando o roteador
 * entende que houve um retorno em rodovia (o ponto caiu na pista contrária), o
 * km com retorno é maior — mas em pista simples ele pode se enganar. Aqui o
 * motorista confirma o que aconteceu de verdade, com o KM na frente (o número
 * que ele entende), sem virar divergência: a escolha vira km + kmCalculado.
 *
 * Reusa o mapa iOS-safe do seletor de rotas (Polylines fixas, seleção muda só
 * cor). As opções vêm de /m/rotas/opcoes na ordem [sem_retorno, com_retorno];
 * só renderiza quando há de fato 2 opções.
 */

type Props = {
  opcoes: RotaOption[];
  selecionadaIdx: number;
  onSelecionar: (idx: number) => void;
  height?: number;
};

function rotulo(r: RotaOption): { titulo: string; sub: string } {
  // Sem "sugerido pelo sistema" de propósito: o sistema não empurra o motorista
  // pro km maior. Ele escolhe o que realmente fez.
  if (r.retorno) {
    return { titulo: "Precisei voltar no retorno", sub: "Passa e volta no retorno" };
  }
  return { titulo: "Cheguei direto", sub: "Sem retorno" };
}

export function SeletorRetorno({
  opcoes,
  selecionadaIdx,
  onSelecionar,
  height = 220,
}: Props) {
  if (opcoes.length < 2) return null;

  function selecionar(idx: number) {
    void Haptics.selectionAsync();
    onSelecionar(idx);
  }

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold text-foreground">
        Como você chegou na descarga?
      </Text>
      <Text className="-mt-1 text-sm text-muted-foreground">
        Nesse ponto dá pra chegar direto ou precisa passar e voltar no retorno.
        Toque no que aconteceu — o km ajusta sozinho.
      </Text>

      <RotasMapa rotas={opcoes} height={height} selecionadaIdx={selecionadaIdx} />

      <View className="gap-2">
        {opcoes.map((r, idx) => {
          const selecionada = idx === selecionadaIdx;
          const cor = corDaRota(idx);
          const { titulo, sub } = rotulo(r);
          return (
            <Pressable
              key={idx}
              onPress={() => selecionar(idx)}
              className="flex-row items-center gap-3 rounded-xl border-2 p-3.5 active:opacity-80"
              style={{
                borderColor: selecionada ? cor : "#e2e8f0",
                backgroundColor: selecionada ? `${cor}12` : "transparent",
              }}
            >
              <View className="h-4 w-4 rounded-full" style={{ backgroundColor: cor }} />
              <View className="flex-1">
                <Text className="text-base font-bold text-foreground">{titulo}</Text>
                <Text className="text-lg font-bold text-foreground">
                  {r.km} km
                  <Text className="text-xs font-medium text-muted-foreground">
                    {"   "}
                    {sub}
                  </Text>
                </Text>
              </View>
              {selecionada && <Check size={24} color={cor} strokeWidth={3} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
