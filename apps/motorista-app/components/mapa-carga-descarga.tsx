import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import polylineLib from "@mapbox/polyline";

/**
 * Mapa de viagem sem GPS tracking: mostra carga (verde), descarga (vermelho),
 * lançamento (azul, opcional) e polilinha do trajeto. Quando há geometria do
 * OSRM, desenha o trajeto real; senão, reta entre carga e descarga.
 *
 * Mesmo padrão de dynamic import dos outros mapas (top-level quebra boot do
 * expo-router).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapMod = any;

export type Ponto = { lat: number; lng: number; nome?: string };

type Props = {
  carga: Ponto | null;
  descarga: Ponto | null;
  lancamento: { lat: number; lng: number } | null;
  geometria: string | null;
  height?: number;
};

export function MapaCargaDescarga({
  carga,
  descarga,
  lancamento,
  geometria,
  height = 240,
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

  const traçado = useMemo<{ latitude: number; longitude: number }[]>(() => {
    if (geometria) {
      try {
        return (polylineLib.decode(geometria) as [number, number][]).map(
          ([lat, lng]) => ({ latitude: lat, longitude: lng }),
        );
      } catch {
        return [];
      }
    }
    if (carga && descarga) {
      return [
        { latitude: carga.lat, longitude: carga.lng },
        { latitude: descarga.lat, longitude: descarga.lng },
      ];
    }
    return [];
  }, [geometria, carga, descarga]);

  const ehFallbackReta = !geometria && traçado.length > 0;

  const todosLats = useMemo(() => {
    const lats: number[] = [];
    if (carga) lats.push(carga.lat);
    if (descarga) lats.push(descarga.lat);
    if (lancamento) lats.push(lancamento.lat);
    traçado.forEach((p) => lats.push(p.latitude));
    return lats;
  }, [carga, descarga, lancamento, traçado]);

  const todosLngs = useMemo(() => {
    const lngs: number[] = [];
    if (carga) lngs.push(carga.lng);
    if (descarga) lngs.push(descarga.lng);
    if (lancamento) lngs.push(lancamento.lng);
    traçado.forEach((p) => lngs.push(p.longitude));
    return lngs;
  }, [carga, descarga, lancamento, traçado]);

  if (todosLats.length === 0 || !mod) {
    return <View className="rounded-xl bg-muted/40" style={{ height }} />;
  }

  const MapView = mod.default;
  const Marker = mod.Marker;
  const Polyline = mod.Polyline;
  const provider = mod.PROVIDER_GOOGLE;

  const minLat = Math.min(...todosLats);
  const maxLat = Math.max(...todosLats);
  const minLng = Math.min(...todosLngs);
  const maxLng = Math.max(...todosLngs);
  const region = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.5),
  };

  const mapProps: Record<string, unknown> = {
    style: { flex: 1 },
    initialRegion: region,
  };
  if (provider) mapProps.provider = provider;

  return (
    <View className="overflow-hidden rounded-xl" style={{ height }}>
      <MapView {...mapProps}>
        {traçado.length >= 2 && (
          <Polyline
            coordinates={traçado}
            strokeColor={ehFallbackReta ? "#94a3b8" : "#ea580c"}
            strokeWidth={ehFallbackReta ? 3 : 4}
            lineDashPattern={ehFallbackReta ? [6, 8] : undefined}
          />
        )}
        {carga && (
          <Marker
            coordinate={{ latitude: carga.lat, longitude: carga.lng }}
            pinColor="green"
            title="Carga"
            description={carga.nome}
          />
        )}
        {descarga && (
          <Marker
            coordinate={{ latitude: descarga.lat, longitude: descarga.lng }}
            pinColor="red"
            title="Descarga"
            description={descarga.nome}
          />
        )}
        {lancamento && (
          <Marker
            coordinate={{ latitude: lancamento.lat, longitude: lancamento.lng }}
            pinColor="blue"
            description="Onde foi lançada"
          />
        )}
      </MapView>
    </View>
  );
}
