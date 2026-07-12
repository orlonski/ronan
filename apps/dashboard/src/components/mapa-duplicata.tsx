"use client";

import { Fragment, useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type LocalDupMapa = {
  id: string;
  nome: string;
  lat: number | null;
  lng: number | null;
  pontos: { lat: number; lng: number; origem: "descarga" | "abertura" }[];
};

// Uma cor por local do grupo (pin + pontos de descarga na mesma cor). Se dois
// locais são o mesmo lugar, as manchas de cores se sobrepõem.
export const CORES = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706",
  "#7c3aed", "#0891b2", "#db2777", "#4b5563",
];

function pinIcon(cor: string, label: string) {
  return L.divIcon({
    html: `<div style="
      width:22px;height:22px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);background:${cor};
      border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);
      display:flex;align-items:center;justify-content:center;
    "><span style="transform:rotate(45deg);color:#fff;font:700 11px system-ui">${label}</span></div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -20],
  });
}

function FitTudo({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0]!, 16);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 17 });
  }, [pts, map]);
  return null;
}

export function MapaDuplicata({ locais }: { locais: LocalDupMapa[] }) {
  const comCor = useMemo(
    () => locais.map((l, i) => ({ ...l, cor: CORES[i % CORES.length]! })),
    [locais],
  );
  const pts = useMemo(() => {
    const arr: [number, number][] = [];
    for (const l of comCor) {
      if (l.lat != null && l.lng != null) arr.push([l.lat, l.lng]);
      for (const p of l.pontos) arr.push([p.lat, p.lng]);
    }
    return arr;
  }, [comCor]);

  return (
    <div className="space-y-2">
      <div className="h-[360px] overflow-hidden rounded-md border">
        <MapContainer
          center={[-25.43, -49.27]}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitTudo pts={pts} />
          {comCor.map((l, i) => (
            <Fragment key={l.id}>
              {/* Pontos de descarga (GPS real das viagens) — mancha da cor do local */}
              {l.pontos.map((p, j) => (
                <CircleMarker
                  key={`${l.id}-${j}`}
                  center={[p.lat, p.lng]}
                  radius={4}
                  pathOptions={{
                    color: l.cor,
                    weight: 1,
                    fillColor: l.cor,
                    fillOpacity: p.origem === "descarga" ? 0.55 : 0.2,
                  }}
                />
              ))}
              {/* Pin do local cadastrado */}
              {l.lat != null && l.lng != null && (
                <Marker position={[l.lat, l.lng]} icon={pinIcon(l.cor, String(i + 1))}>
                  <Popup>
                    <div className="space-y-0.5">
                      <p className="font-semibold leading-tight">{l.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.pontos.length} descarga{l.pontos.length === 1 ? "" : "s"} de viagem
                      </p>
                    </div>
                  </Popup>
                </Marker>
              )}
            </Fragment>
          ))}
        </MapContainer>
      </div>
      {/* Legenda: cor → local */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {comCor.map((l, i) => (
          <li key={l.id} className="flex items-center gap-1.5">
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: l.cor }}
            >
              {i + 1}
            </span>
            <span className="font-medium">{l.nome}</span>
            <span className="text-muted-foreground">
              · {l.pontos.length} viagem{l.pontos.length === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
