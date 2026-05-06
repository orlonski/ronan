import { useEffect, useState } from "react";
import { View } from "react-native";

/**
 * Mini-mapa com 1 pino. Igual MapTrajeto mas pra caso onde só temos
 * o ponto de lançamento (viagem sem tracking GPS).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapMod = any;

type Props = {
  lat: number;
  lng: number;
  height?: number;
  title?: string;
};

export function MapPino({ lat, lng, height = 200, title }: Props) {
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
  const provider = mod.PROVIDER_GOOGLE;

  const region = {
    latitude: lat,
    longitude: lng,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  };

  const mapProps: Record<string, unknown> = {
    style: { flex: 1 },
    initialRegion: region,
  };
  if (provider) mapProps.provider = provider;

  return (
    <View
      className="overflow-hidden rounded-xl"
      style={{ height }}
    >
      <MapView {...mapProps}>
        <Marker coordinate={{ latitude: lat, longitude: lng }} title={title} />
      </MapView>
    </View>
  );
}
