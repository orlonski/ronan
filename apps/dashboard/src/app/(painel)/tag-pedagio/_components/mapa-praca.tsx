"use client";

import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** A cidade que o extrato imprime (círculo) e as praças do mapa que podem ser ela (pinos numerados). */
export type PontoPraca = { id: string; nome: string; lat: number; lng: number };

const pino = (n: number) =>
  L.divIcon({
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2F66C9;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 11px system-ui">${n}</span></div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  });

function Enquadrar({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length === 1) map.setView(pts[0]!, 10);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 12 });
  }, [pts, map]);
  return null;
}

export function MapaPraca({ sede, cidade, candidatos }: { sede: { lat: number; lng: number } | null; cidade: string; candidatos: PontoPraca[] }) {
  const pts = useMemo(
    () => [...(sede ? [[sede.lat, sede.lng] as [number, number]] : []), ...candidatos.map((c) => [c.lat, c.lng] as [number, number])],
    [sede, candidatos],
  );
  return (
    <div className="h-[260px] overflow-hidden rounded-md border max-2xl:h-[220px]">
      <MapContainer center={pts[0] ?? [-15.6, -56.1]} zoom={9} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Enquadrar pts={pts} />
        {sede && (
          <CircleMarker center={[sede.lat, sede.lng]} radius={8} pathOptions={{ color: "#B4501A", fillColor: "#DF7234", fillOpacity: 0.6 }}>
            <Tooltip permanent direction="top">{cidade}</Tooltip>
          </CircleMarker>
        )}
        {candidatos.map((c, i) => (
          <Marker key={c.id} position={[c.lat, c.lng]} icon={pino(i + 1)}>
            <Popup>{c.nome}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
