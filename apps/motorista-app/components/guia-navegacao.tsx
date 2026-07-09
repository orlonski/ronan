import { View } from "react-native";
import { MapaNavegacao } from "@/components/mapa-navegacao";
import { BannerManobra } from "@/components/banner-manobra";
import { usePosicaoAoVivo, useGuiaNavegacao } from "@/lib/navegacao";
import type { RotaNav } from "@/lib/queries";

/**
 * Junta o guia ao vivo: banner da manobra (topo) + mapa com a rota/bolinha +
 * motor turf + voz. Quando o motorista sai da rota (~5s), chama `onRecalcular`.
 *
 * Fase 4 / iOS: ao recalcular, a `rota.shape` muda → damos `key={rota.shape}` no
 * MapaNavegacao pra REMONTAR o mapa (trocar a Polyline por remontagem, não por
 * mutação de coords — que é o que crasha o Apple Maps).
 */
export function GuiaNavegacao({
  rota,
  destino,
  onRecalcular,
}: {
  rota: RotaNav;
  destino: { lat: number; lng: number; nome?: string };
  onRecalcular?: () => void;
}) {
  const pos = usePosicaoAoVivo(true);
  const guia = useGuiaNavegacao(rota, pos, onRecalcular);

  return (
    <View className="gap-2">
      <BannerManobra
        manobra={guia.manobra}
        distProxM={guia.distProxM}
        restanteM={guia.restanteM}
        foraDaRota={guia.foraDaRota}
      />
      <MapaNavegacao
        key={rota.shape}
        shape={rota.shape}
        destino={destino}
        pos={pos}
        height={340}
      />
    </View>
  );
}
