import { useEffect, useState } from "react";
import { View } from "react-native";

/**
 * Encapsula react-native-maps via dynamic import. Top-level import
 * dessa lib em arquivo de rota quebra o boot do expo-router
 * ('Objects are not valid as a React child'). Carrega o módulo só
 * depois que o componente monta — fora do caminho de descoberta de
 * rotas.
 */

export type MapPonto = { lat: number; lng: number };

// `any` proposital — a tipagem do react-native-maps importado dinamicamente
// não cooperava com props. Tipos não importam em runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapMod = any;

type Props = {
  pontos: MapPonto[];
  height?: number;
  follow?: boolean;
  /** Mostra marker do início (verde) e fim (vermelho). Default: true. */
  markersExtremos?: boolean;
};

export function MapTrajeto({
  pontos,
  height = 280,
  follow = false,
  markersExtremos = true,
}: Props) {
  const [mod, setMod] = useState<MapMod | null>(null);

  useEffect(() => {
    let alive = true;
    void import("react-native-maps").then((m) => {
      if (alive) setMod(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (pontos.length < 2) {
    return (
      <View
        className="rounded-xl bg-muted/40"
        style={{ height }}
      />
    );
  }

  if (!mod) {
    return (
      <View
        className="rounded-xl bg-muted/40"
        style={{ height }}
      />
    );
  }

  const MapView = mod.default;
  const Marker = mod.Marker;
  const Polyline = mod.Polyline;
  const provider = mod.PROVIDER_GOOGLE;

  const lats = pontos.map((p) => p.lat);
  const lngs = pontos.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const region = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.5),
  };

  const inicio = pontos[0]!;
  const fim = pontos[pontos.length - 1]!;

  const mapProps: Record<string, unknown> = {
    style: { flex: 1 },
    initialRegion: region,
    showsUserLocation: follow,
    followsUserLocation: follow,
  };
  if (provider) mapProps.provider = provider;

  return (
    <View
      className="overflow-hidden rounded-xl"
      style={{ height }}
    >
      <MapView {...mapProps}>
        <Polyline
          coordinates={pontos.map((p) => ({
            latitude: p.lat,
            longitude: p.lng,
          }))}
          strokeColor="#ea580c"
          strokeWidth={4}
        />
        {markersExtremos && (
          <>
            <Marker
              coordinate={{ latitude: inicio.lat, longitude: inicio.lng }}
              pinColor="green"
              title="Início"
            />
            <Marker
              coordinate={{ latitude: fim.lat, longitude: fim.lng }}
              pinColor="red"
              title="Fim"
            />
          </>
        )}
      </MapView>
    </View>
  );
}
