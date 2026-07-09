import { Text, View } from "react-native";
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  RotateCcw,
} from "lucide-react-native";
import type { ManobraNav } from "@/lib/queries";

/**
 * Banner grande da próxima manobra (topo do guia): seta + texto ("Vire à direita
 * na Rua X") + distância. Feito pra bater o olho dirigindo. O ícone é aproximado
 * pelo tipo de manobra do Valhalla; o texto é a fonte da verdade.
 */

// Tipos de manobra do Valhalla (subset comum). Ver docs turn-by-turn.
function IconeManobra({ tipo }: { tipo: number }) {
  const cor = "#2563eb";
  const size = 34;
  // 1/2/3 start/continue; 4/5/6 destino; 8 continue; 9/10 slight; 15/16 right;
  // 19/20 left; 24/25 uturn; 26/27 roundabout. Aproximação:
  if (tipo === 4 || tipo === 5 || tipo === 6) return <Flag size={size} color={cor} />;
  if (tipo === 24 || tipo === 25) return <RotateCcw size={size} color={cor} />;
  if (tipo === 15 || tipo === 16 || tipo === 17) return <CornerUpRight size={size} color={cor} />;
  if (tipo === 19 || tipo === 20 || tipo === 21) return <CornerUpLeft size={size} color={cor} />;
  if (tipo === 9 || tipo === 10) return <ArrowRight size={size} color={cor} />;
  if (tipo === 11 || tipo === 12) return <ArrowLeft size={size} color={cor} />;
  return <ArrowUp size={size} color={cor} />;
}

function fmtDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
  return `${Math.max(0, Math.round(m / 10) * 10)} m`;
}

export function BannerManobra({
  manobra,
  distProxM,
  restanteM,
  foraDaRota,
}: {
  manobra: ManobraNav | null;
  distProxM: number;
  restanteM: number;
  foraDaRota?: boolean;
}) {
  // Fora da rota: aviso local (não depende de internet). A "próxima manobra" não
  // faz sentido quando o motorista está longe da linha — mostra o alerta no lugar.
  if (foraDaRota) {
    return (
      <View className="rounded-2xl border-2 border-warning bg-warning/15 p-4">
        <View className="flex-row items-center gap-3">
          <AlertTriangle size={30} color="#b45309" />
          <View className="flex-1">
            <Text className="text-lg font-bold text-foreground">
              Você saiu da rota
            </Text>
            <Text className="text-sm font-medium text-muted-foreground">
              Volte pra linha azul — ou toque em “Navegar no Waze”. Sem sinal, a
              rota não recalcula, mas a voz continua no trecho que já baixou.
            </Text>
          </View>
        </View>
      </View>
    );
  }
  if (!manobra) return null;
  return (
    <View className="rounded-2xl border-2 border-primary/30 bg-primary/10 p-4">
      <View className="flex-row items-center gap-3">
        <IconeManobra tipo={manobra.tipo} />
        <View className="flex-1">
          <Text className="text-lg font-bold text-foreground" numberOfLines={2}>
            {manobra.instrucao}
          </Text>
          <Text
            className="text-sm font-medium text-muted-foreground"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            em {fmtDist(distProxM)}
            {restanteM > 0 ? ` · faltam ${fmtDist(restanteM)}` : ""}
          </Text>
        </View>
      </View>
    </View>
  );
}
