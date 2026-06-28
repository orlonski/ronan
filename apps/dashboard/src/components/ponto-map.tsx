"use client";

import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export type PontoLancamento = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
};

// Bolinha azul do ponto de lançamento (mesma cor do trajeto da viagem).
const ICONE_LANCAMENTO = L.divIcon({
  className: "",
  html: `<div style="
    width: 14px; height: 14px;
    background: #2563eb;
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 1px 4px rgba(0,0,0,0.35);
  "></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function FitBounds({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || pontos.length < 2) return;
    map.fitBounds(L.latLngBounds(pontos), { padding: [30, 30], maxZoom: 16 });
    done.current = true;
  }, [pontos, map]);
  return null;
}

export function PontoMap({
  lat,
  lng,
  label,
  pontos = [],
}: {
  lat: number;
  lng: number;
  label?: string;
  /** Pontos de lançamento das viagens — bolinhas azuis sobre o mapa. */
  pontos?: PontoLancamento[];
}) {
  const todos: [number, number][] = [
    [lat, lng],
    ...pontos.map((p) => [p.lat, p.lng] as [number, number]),
  ];

  return (
    <div className="h-64 overflow-hidden rounded-lg border">
      <MapContainer
        center={[lat, lng]}
        zoom={15}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pontos.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={ICONE_LANCAMENTO}>
            {p.label && <Popup>{p.label}</Popup>}
          </Marker>
        ))}
        <Marker position={[lat, lng]}>{label && <Popup>{label}</Popup>}</Marker>
        <FitBounds pontos={todos} />
      </MapContainer>
    </div>
  );
}
