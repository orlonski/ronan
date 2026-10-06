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

export type PedagioMapa = {
  id: string;
  nome: string;
  rodovia: string | null;
  lat: number;
  lng: number;
};

type Props = {
  carga: Ponto | null;
  descarga: Ponto | null;
  lancamento: { lat: number; lng: number } | null;
  geometria: string | null;
  pedagios?: PedagioMapa[];
  height?: number;
};

export function MapaCargaDescarga({
  carga,
  descarga,
  lancamento,
  geometria,
  pedagios = [],
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
    if (!geometria) return [];
    try {
      return (polylineLib.decode(geometria) as [number, number][]).map(
        ([lat, lng]) => ({ latitude: lat, longitude: lng }),
      );
    } catch {
      return [];
    }
  }, [geometria]);

  // Onde a viagem foi lançada só entra no enquadramento se estiver perto do
  // trajeto. Viagem lançada depois (de casa, a 1.000 km) encolhia a rota num
  // risco no canto do mapa — o pino segue no mapa, só não manda no zoom.
  const lancamentoNoQuadro = useMemo(() => {
    if (!lancamento) return null;
    const ref = [
      ...(carga ? [{ lat: carga.lat, lng: carga.lng }] : []),
      ...(descarga ? [{ lat: descarga.lat, lng: descarga.lng }] : []),
    ];
    if (ref.length === 0) return lancamento;
    const perto = ref.some(
      (r) => Math.abs(r.lat - lancamento.lat) < 0.5 && Math.abs(r.lng - lancamento.lng) < 0.5,
    );
    return perto ? lancamento : null;
  }, [carga, descarga, lancamento]);

  const todosLats = useMemo(() => {
    const lats: number[] = [];
    if (carga) lats.push(carga.lat);
    if (descarga) lats.push(descarga.lat);
    if (lancamentoNoQuadro) lats.push(lancamentoNoQuadro.lat);
    traçado.forEach((p) => lats.push(p.latitude));
    pedagios.forEach((p) => lats.push(p.lat));
    return lats;
  }, [carga, descarga, lancamentoNoQuadro, traçado, pedagios]);

  const todosLngs = useMemo(() => {
    const lngs: number[] = [];
    if (carga) lngs.push(carga.lng);
    if (descarga) lngs.push(descarga.lng);
    if (lancamentoNoQuadro) lngs.push(lancamentoNoQuadro.lng);
    traçado.forEach((p) => lngs.push(p.longitude));
    pedagios.forEach((p) => lngs.push(p.lng));
    return lngs;
  }, [carga, descarga, lancamentoNoQuadro, traçado, pedagios]);

  if (todosLats.length === 0 || !mod) {
    return <View className="rounded-xl bg-muted/40" style={{ height }} />;
  }

  const MapView = mod.default;
  const Marker = mod.Marker;
  const Polyline = mod.Polyline;
  // Google Maps nas DUAS plataformas: no iOS o Apple Maps não desenhava a
  // polilinha (mesma correção do mapa-viagem).
  const provider = mod.PROVIDER_GOOGLE;
  // A rota e os pedágios chegam depois do mapa montar; `initialRegion` só vale
  // na montagem e a polilinha nova não aparece no iPhone. Remonta quando mudam.
  const chaveMapa = `${geometria?.length ?? 0}:${geometria?.slice(-8) ?? ""}:${pedagios.length}`;

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
      <MapView key={chaveMapa} {...mapProps}>
        {traçado.length >= 2 && (
          <Polyline coordinates={traçado} strokeColor="#ea580c" strokeWidth={4} />
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
        {pedagios.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lng }}
            pinColor="orange"
            title={p.nome}
            description={p.rodovia ?? "Pedágio"}
          />
        ))}
      </MapView>
    </View>
  );
}
