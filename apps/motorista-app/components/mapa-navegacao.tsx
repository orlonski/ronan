import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import polyline from "@mapbox/polyline";
import type { PosAoVivo } from "@/lib/navegacao";

/**
 * Mapa ao vivo do guia de navegação: desenha a ROTA (shape do Valhalla) FIXA +
 * marcador do destino + a bolinha azul nativa do motorista (showsUserLocation) e
 * a CÂMERA estilo Waze — zoom fechado, inclinada em 3D e girada pro rumo que o
 * motorista dirige ("nariz pra cima"), seguindo a posição ao vivo.
 *
 * Segurança iOS: a rota é montada UMA vez com coordenadas estáveis (memoizadas) e
 * nunca é re-mutada — é o padrão que evita o crash do Apple Maps. Só a CÂMERA se
 * mexe (animateCamera), que é uma operação segura. Quando a rota muda (recálculo),
 * o pai troca a `key` e REMONTA o mapa (não muta a Polyline).
 *
 * Dynamic import do react-native-maps (top-level quebra o boot do expo-router).
 */

// Módulo dinâmico do react-native-maps (tipagem não coopera com dynamic import).
type MapMod = any;
type LatLng = { latitude: number; longitude: number };

type Props = {
  /** Polyline encoded do Valhalla — PRECISÃO 6. */
  shape: string;
  destino: { lat: number; lng: number; nome?: string };
  /** Posição ao vivo — dirige a chase cam. */
  pos?: PosAoVivo | null;
  height?: number;
};

// Chase cam estilo Waze.
const ZOOM_NAV = 17;
const PITCH_NAV = 55;

export const MapaNavegacao = memo(function MapaNavegacao({
  shape,
  destino,
  pos,
  height = 320,
}: Props) {
  const [mod, setMod] = useState<MapMod | null>(null);
  const mapRef = useRef<any>(null);
  // Guarda o último rumo VÁLIDO (heading vem -1/null parado) pra não "desvirar".
  const headingRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void import("react-native-maps").then((m) => {
      if (alive) setMod(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Chase cam: a cada posição, centraliza em você com zoom fechado + 3D + rumo.
  useEffect(() => {
    if (!mapRef.current || !pos) return;
    if (pos.heading != null && pos.heading >= 0) headingRef.current = pos.heading;
    try {
      mapRef.current.animateCamera(
        {
          center: { latitude: pos.lat, longitude: pos.lng },
          heading: headingRef.current,
          pitch: PITCH_NAV,
          zoom: ZOOM_NAV,
        },
        { duration: 900 },
      );
    } catch {
      /* animateCamera antes do mapa pronto: ignora */
    }
  }, [pos]);

  const coords = useMemo<LatLng[]>(() => {
    try {
      // Valhalla usa precisão 6 (o default do @mapbox/polyline é 5).
      return polyline
        .decode(shape, 6)
        .map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
    } catch {
      return [];
    }
  }, [shape]);

  const region = useMemo(() => {
    if (coords.length === 0) return null;
    const lats = coords.map((p) => p.latitude);
    const lngs = coords.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.4),
      longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.4),
    };
  }, [coords]);

  if (!mod || !region || coords.length < 2) {
    return <View className="rounded-xl bg-muted/40" style={{ height }} />;
  }

  const MapView = mod.default;
  const Marker = mod.Marker;
  const Polyline = mod.Polyline;
  const provider = Platform.OS === "android" ? mod.PROVIDER_GOOGLE : undefined;

  const mapProps: Record<string, unknown> = {
    ref: mapRef,
    style: { flex: 1 },
    // Nasce enquadrando a rota; a chase cam assume assim que chega a 1ª posição.
    initialRegion: region,
    showsUserLocation: true,
    // followsUserLocation OFF de propósito: a câmera é dirigida por animateCamera
    // (com rumo + 3D), senão as duas brigam pelo controle no iOS.
    showsCompass: true,
    pitchEnabled: true,
    rotateEnabled: true,
  };
  if (provider) mapProps.provider = provider;

  return (
    <View className="overflow-hidden rounded-xl" style={{ height }}>
      <MapView {...mapProps}>
        <Polyline coordinates={coords} strokeColor="#2563eb" strokeWidth={6} />
        <Marker
          coordinate={{ latitude: destino.lat, longitude: destino.lng }}
          pinColor="red"
          title={destino.nome ?? "Destino"}
        />
      </MapView>
    </View>
  );
});
