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
 * Banner grande da próxima manobra (topo do guia), estilo Waze: fundo SÓLIDO
 * (azul) + seta + distância em destaque + nome da rua GRANDE e legível de
 * relance dirigindo. O ícone é aproximado pelo tipo do Valhalla; o texto é a
 * fonte da verdade.
 */

// Tipos de manobra do Valhalla (subset comum). Ver docs turn-by-turn.
function IconeManobra({ tipo }: { tipo: number }) {
  const cor = "#ffffff";
  const size = 32;
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
      <View className="flex-row items-center gap-3 rounded-2xl bg-warning px-4 py-3 shadow-lg">
        <AlertTriangle size={32} color="#ffffff" />
        <View className="flex-1">
          <Text className="text-xl font-extrabold text-white">
            Você saiu da rota
          </Text>
          <Text className="text-sm font-medium text-white/90">
            Volte pra linha azul ou toque em “Navegar no Waze”.
          </Text>
        </View>
      </View>
    );
  }
  if (!manobra) return null;
  return (
    <View className="flex-row items-center gap-4 rounded-2xl bg-primary px-4 py-3 shadow-lg">
      {/* Seta + distância (bloco esquerdo, estilo Waze) */}
      <View className="items-center" style={{ minWidth: 68 }}>
        <IconeManobra tipo={manobra.tipo} />
        <Text
          className="mt-0.5 text-xl font-extrabold text-white"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {fmtDist(distProxM)}
        </Text>
      </View>

      {/* Instrução (nome da rua GRANDE) */}
      <View className="flex-1">
        <Text
          className="text-2xl font-extrabold leading-tight text-white"
          numberOfLines={3}
        >
          {manobra.instrucao}
        </Text>
        {restanteM > 0 && (
          <Text
            className="mt-0.5 text-xs font-semibold text-white/80"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            faltam {fmtDist(restanteM)}
          </Text>
        )}
      </View>
    </View>
  );
}
