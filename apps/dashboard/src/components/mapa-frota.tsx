"use client";

import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapaFrotaItem } from "@ronan/shared-types";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function pinoMotorista(iniciais: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 36px; height: 36px;
      background: #2563eb;
      color: white;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 12px; font-family: system-ui;
    ">${iniciais}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function FitBounds({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  const lastCount = useRef(0);
  useEffect(() => {
    if (pontos.length === 0) return;
    // Re-fit só quando o número de motoristas mudar (entrada/saída do mapa).
    // Evita pular o zoom quando admin tá investigando algo.
    if (pontos.length === lastCount.current) return;
    lastCount.current = pontos.length;
    map.fitBounds(L.latLngBounds(pontos), { padding: [50, 50], maxZoom: 14 });
  }, [pontos, map]);
  return null;
}

function tempoRelativo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function iniciais(nome: string): string {
  const parts = nome.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function MapaFrota({ items }: { items: MapaFrotaItem[] }) {
  const pontos: [number, number][] = items.map((i) => [
    i.ultimaPosicao.lat,
    i.ultimaPosicao.lng,
  ]);
  // Centro inicial: primeiro motorista OU São Paulo como fallback.
  const centro: [number, number] = pontos[0] ?? [-23.55, -46.63];

  return (
    <div className="h-[70vh] w-full overflow-hidden rounded-lg border bg-muted">
      <MapContainer
        center={centro}
        zoom={12}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds pontos={pontos} />
        {items.map((m) => (
          <Marker
            key={m.motorista.id}
            position={[m.ultimaPosicao.lat, m.ultimaPosicao.lng]}
            icon={pinoMotorista(iniciais(m.motorista.nome))}
          >
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-bold">{m.motorista.nome}</p>
                {m.motorista.veiculo && (
                  <p className="text-xs text-muted-foreground">
                    Placa{" "}
                    <span className="font-mono">{m.motorista.veiculo.placa}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {tempoRelativo(m.ultimaPosicao.capturadoEm)}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
