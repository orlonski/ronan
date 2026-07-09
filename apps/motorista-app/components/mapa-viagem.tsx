import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import polyline from "@mapbox/polyline";
import type { PosAoVivo } from "@/lib/navegacao";

/**
 * Mapa HERO da tela "Viagem em andamento" (estilo Waze). Funde o que antes eram
 * dois mapas separados (guia de navegação + trajeto percorrido) num só:
 *
 *  - trilha (laranja): o caminho já percorrido — só no modo SEM destino, pra não
 *    crashar o Apple Maps ao mutar a Polyline durante a navegação.
 *  - rota (azul): o caminho À FRENTE até a descarga (shape do Valhalla, prec. 6).
 *    Keyed por `shape` → ao recalcular, REMONTA a Polyline (não muta coords).
 *  - câmera: segue a posição ao vivo. Navegando = chase cam 3D "nariz pra cima";
 *    sem destino = topo-norte, mais afastado.
 *
 * `mapPadding` empurra os controles/logo do Google pra cima da barra inferior e
 * centraliza o motorista na área visível (acima da barra).
 */

// Módulo dinâmico do react-native-maps (tipagem não coopera com dynamic import).
type MapMod = any;
type LatLng = { latitude: number; longitude: number };

type Props = {
  /** Caminho já percorrido (tracking). Desenhado só quando NÃO está navegando. */
  trilha?: { lat: number; lng: number }[];
  /** Rota à frente (Valhalla polyline6). Presente = modo navegação (chase cam). */
  shape?: string;
  destino?: { lat: number; lng: number; nome?: string };
  /** Posição ao vivo — dirige a câmera. */
  pos?: PosAoVivo | null;
  /** Espaço reservado embaixo (barra) e em cima (banner) pros controles do mapa. */
  padTop?: number;
  padBottom?: number;
};

const ZOOM_NAV = 17;
const PITCH_NAV = 55;
const ZOOM_VIAGEM = 15.5;

export function MapaViagem({
  trilha,
  shape,
  destino,
  pos,
  padTop = 150,
  padBottom = 230,
}: Props) {
  const [mod, setMod] = useState<MapMod | null>(null);
  const mapRef = useRef<any>(null);
  const headingRef = useRef(0);
  const navegando = !!shape;

  useEffect(() => {
    let alive = true;
    void import("react-native-maps").then((m) => {
      if (alive) setMod(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  const rota = useMemo<LatLng[]>(() => {
    if (!shape) return [];
    try {
      return polyline
        .decode(shape, 6)
        .map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
    } catch {
      return [];
    }
  }, [shape]);

  const trilhaCoords = useMemo<LatLng[]>(
    () => (trilha ?? []).map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [trilha],
  );

  // Enquadramento inicial: cobre rota + trilha + destino.
  const region = useMemo(() => {
    const all = [...rota, ...trilhaCoords];
    if (destino) all.push({ latitude: destino.lat, longitude: destino.lng });
    if (all.length === 0) return null;
    const lats = all.map((p) => p.latitude);
    const lngs = all.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.008, (maxLat - minLat) * 1.5),
      longitudeDelta: Math.max(0.008, (maxLng - minLng) * 1.5),
    };
  }, [rota, trilhaCoords, destino]);

  // Câmera segue a posição. Navegando = chase cam; senão = topo-norte afastado.
  useEffect(() => {
    if (!mapRef.current || !pos) return;
    if (pos.heading != null && pos.heading >= 0) headingRef.current = pos.heading;
    try {
      mapRef.current.animateCamera(
        {
          center: { latitude: pos.lat, longitude: pos.lng },
          heading: navegando ? headingRef.current : 0,
          pitch: navegando ? PITCH_NAV : 0,
          zoom: navegando ? ZOOM_NAV : ZOOM_VIAGEM,
        },
        { duration: 900 },
      );
    } catch {
      /* animateCamera antes do mapa pronto: ignora */
    }
  }, [pos, navegando]);

  if (!mod) return <View className="flex-1 bg-muted/30" />;

  const MapView = mod.default;
  const Marker = mod.Marker;
  const Polyline = mod.Polyline;
  const provider = Platform.OS === "android" ? mod.PROVIDER_GOOGLE : undefined;

  const mapProps: Record<string, unknown> = {
    ref: mapRef,
    style: { flex: 1 },
    showsUserLocation: true,
    showsCompass: true,
    pitchEnabled: true,
    rotateEnabled: true,
    mapPadding: { top: padTop, bottom: padBottom, left: 8, right: 8 },
  };
  if (region) mapProps.initialRegion = region;
  if (provider) mapProps.provider = provider;

  return (
    <View className="flex-1">
      <MapView {...mapProps}>
        {/* Trilha só fora da navegação (evita mutar Polyline no Apple Maps). */}
        {!navegando && trilhaCoords.length >= 2 && (
          <Polyline
            coordinates={trilhaCoords}
            strokeColor="#f97316"
            strokeWidth={5}
          />
        )}
        {rota.length >= 2 && (
          <Polyline
            key={shape}
            coordinates={rota}
            strokeColor="#2563eb"
            strokeWidth={7}
          />
        )}
        {destino && (
          <Marker
            coordinate={{ latitude: destino.lat, longitude: destino.lng }}
            pinColor="red"
            title={destino.nome ?? "Destino"}
          />
        )}
      </MapView>
    </View>
  );
}
