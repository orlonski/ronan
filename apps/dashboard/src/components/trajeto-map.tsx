"use client";

import { useEffect } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix dos icons quebrados do leaflet com bundlers Next.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export type Ponto = { lat: number; lng: number };

function FitToBounds({ pontos }: { pontos: Ponto[] }) {
  const map = useMap();
  useEffect(() => {
    if (pontos.length === 0) return;
    const bounds = L.latLngBounds(pontos.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [pontos, map]);
  return null;
}

export function TrajetoMap({ pontos }: { pontos: Ponto[] }) {
  if (pontos.length < 2) return null;
  const inicio = pontos[0]!;
  const fim = pontos[pontos.length - 1]!;

  return (
    <div className="h-80 overflow-hidden rounded-lg border">
      <MapContainer
        center={[inicio.lat, inicio.lng]}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline
          positions={pontos.map((p) => [p.lat, p.lng])}
          color="#ea580c"
          weight={4}
        />
        <Marker position={[inicio.lat, inicio.lng]}>
          <Popup>Início</Popup>
        </Marker>
        <Marker position={[fim.lat, fim.lng]}>
          <Popup>Fim</Popup>
        </Marker>
        <FitToBounds pontos={pontos} />
      </MapContainer>
    </div>
  );
}
