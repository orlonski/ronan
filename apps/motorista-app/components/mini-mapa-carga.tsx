import { memo, useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { formatarDistancia, haversineMetros, RAIO_ALERTA_CARGA_M } from "@/lib/geo";

/**
 * Mini-mapa "você × local de carga" na tela de Iniciar viagem: mostra a posição
 * do motorista vs o local escolhido, com um banner grande de perto/longe. É só
 * reforço visual do mesmo dado que vai ser gravado (cargaDistanciaMetros).
 *
 * react-native-maps via dynamic import (top-level import quebra o boot do
 * expo-router). Memoizado + coords estáveis + Polyline SEM tappable/onPress/
 * zIndex — evita o crash nativo do Apple Maps ao re-mutar overlays.
 */

export type MiniMapaPonto = { lat: number; lng: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapMod = any;

function MiniMapaCargaBase({
  motorista,
  local,
  distanciaMetros,
  height = 200,
}: {
  motorista: MiniMapaPonto;
  local: MiniMapaPonto;
  /** Distância já calculada (m). Se ausente, calcula por haversine. */
  distanciaMetros?: number | null;
  height?: number;
}) {
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

  const dist =
    distanciaMetros != null
      ? distanciaMetros
      : Math.round(haversineMetros(motorista.lat, motorista.lng, local.lat, local.lng));
  const perto = dist <= RAIO_ALERTA_CARGA_M;

  const region = {
    latitude: (motorista.lat + local.lat) / 2,
    longitude: (motorista.lng + local.lng) / 2,
    latitudeDelta: Math.max(0.01, Math.abs(motorista.lat - local.lat) * 1.8),
    longitudeDelta: Math.max(0.01, Math.abs(motorista.lng - local.lng) * 1.8),
  };

  return (
    <View className="gap-2">
      <View
        className={`rounded-2xl border-2 px-4 py-3 ${
          perto ? "border-success/50 bg-success/15" : "border-warning/60 bg-warning/15"
        }`}
      >
        <Text className="text-lg font-extrabold text-foreground">
          {perto ? "Você está no local de carga" : `Você está a ${formatarDistancia(dist)} do local`}
        </Text>
        <Text className="mt-0.5 text-sm text-muted-foreground">
          {perto
            ? "Sua posição bate com o local escolhido."
            : "Tudo bem iniciar assim — só confira se é o local certo. A distância fica registrada na viagem."}
        </Text>
      </View>

      {mod ? (
        <View className="overflow-hidden rounded-2xl" style={{ height }}>
          <MapaInterno mod={mod} motorista={motorista} local={local} region={region} perto={perto} />
        </View>
      ) : (
        <View className="rounded-2xl bg-muted/40" style={{ height }} />
      )}
    </View>
  );
}

function MapaInterno({
  mod,
  motorista,
  local,
  region,
  perto,
}: {
  mod: MapMod;
  motorista: MiniMapaPonto;
  local: MiniMapaPonto;
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
  perto: boolean;
}) {
  const MapView = mod.default;
  const Marker = mod.Marker;
  const Polyline = mod.Polyline;
  const provider = Platform.OS === "android" ? mod.PROVIDER_GOOGLE : undefined;

  const mapProps: Record<string, unknown> = {
    style: { flex: 1 },
    initialRegion: region,
    pointerEvents: "none", // só visualização — não precisa arrastar/zoom
  };
  if (provider) mapProps.provider = provider;

  return (
    <MapView {...mapProps}>
      <Polyline
        coordinates={[
          { latitude: motorista.lat, longitude: motorista.lng },
          { latitude: local.lat, longitude: local.lng },
        ]}
        strokeColor={perto ? "#16a34a" : "#d97706"}
        strokeWidth={3}
      />
      <Marker
        coordinate={{ latitude: local.lat, longitude: local.lng }}
        pinColor="red"
        title="Local de carga"
      />
      <Marker
        coordinate={{ latitude: motorista.lat, longitude: motorista.lng }}
        pinColor="blue"
        title="Você"
      />
    </MapView>
  );
}

export const MiniMapaCarga = memo(MiniMapaCargaBase);
