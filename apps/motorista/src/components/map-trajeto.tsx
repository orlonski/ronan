import { useEffect, useMemo } from "react";
import polyline from "@mapbox/polyline";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Render do trajeto via Leaflet (lazy-loaded). Aceita lista de pontos GPS
 * crus (capturados pelo nativo) ou geometria polyline encoded (do OSRM).
 */

// Leaflet por default tenta carregar markers de URL relativa que não existe
// em bundlers tipo Vite. Sobrescreve com data URIs em SVG.
const pinIcon = (color: string) =>
  L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    html: `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="2" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 7 12 7 12s7-6.75 7-12c0-4.42-3.58-8-8-8z"/>
      </svg>
    `,
  });

const cargaIcon = pinIcon("#16a34a");
const descargaIcon = pinIcon("#dc2626");

function FitBounds({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pontos.length === 0) return;
    map.fitBounds(pontos as L.LatLngBoundsLiteral, { padding: [24, 24] });
  }, [map, pontos]);
  return null;
}

export function MapTrajeto({
  pontosCrus,
  geometria,
  carga,
  descarga,
}: {
  pontosCrus?: { lat: number; lng: number }[];
  geometria?: string | null;
  carga?: { lat: number; lng: number; nome: string } | null;
  descarga?: { lat: number; lng: number; nome: string } | null;
}) {
  const pontos = useMemo<[number, number][]>(() => {
    if (pontosCrus && pontosCrus.length > 0) {
      return pontosCrus.map((p) => [p.lat, p.lng]);
    }
    if (geometria) {
      try {
        return polyline.decode(geometria) as [number, number][];
      } catch {
        return [];
      }
    }
    return [];
  }, [pontosCrus, geometria]);

  const all: [number, number][] = useMemo(() => {
    const out = [...pontos];
    if (carga) out.push([carga.lat, carga.lng]);
    if (descarga) out.push([descarga.lat, descarga.lng]);
    return out;
  }, [pontos, carga, descarga]);

  if (all.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
        Sem dados de trajeto pra exibir.
      </div>
    );
  }

  const center: [number, number] = all[0]!;

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-border" style={{ height: 280 }}>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
        attributionControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {pontos.length > 1 && (
          <Polyline positions={pontos} pathOptions={{ color: "#ea580c", weight: 4 }} />
        )}
        {carga && (
          <Marker position={[carga.lat, carga.lng]} icon={cargaIcon} title={carga.nome} />
        )}
        {descarga && (
          <Marker
            position={[descarga.lat, descarga.lng]}
            icon={descargaIcon}
            title={descarga.nome}
          />
        )}
        <FitBounds pontos={all} />
      </MapContainer>
    </div>
  );
}
