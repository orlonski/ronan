"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import polylineLib from "@mapbox/polyline";
import { ExternalLink } from "lucide-react";

// Fix dos icons do leaflet com bundlers Next — mesmo do trajeto-map-player.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function pinoIcon(cor: string, tamanho = 24): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: ${tamanho}px; height: ${tamanho}px;
      background: ${cor};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 0 0 2px ${cor}, 0 2px 8px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [tamanho, tamanho],
    iconAnchor: [tamanho / 2, tamanho / 2],
  });
}

const ICONE_CARGA = pinoIcon("#16a34a");
const ICONE_DESCARGA = pinoIcon("#dc2626");
const ICONE_LANCAMENTO = pinoIcon("#2563eb", 16);

export type Ponto = { lat: number; lng: number; nome?: string };

function FitBounds({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || pontos.length === 0) return;
    map.fitBounds(L.latLngBounds(pontos), { padding: [40, 40] });
    done.current = true;
  }, [pontos, map]);
  return null;
}

type Props = {
  carga: Ponto | null;
  descarga: Ponto | null;
  lancamento: { lat: number; lng: number } | null;
  geometria: string | null;
};

export function MapaTrajetoViagem({ carga, descarga, lancamento, geometria }: Props) {
  const traçado = useMemo<[number, number][]>(() => {
    if (geometria) {
      try {
        return polylineLib.decode(geometria) as [number, number][];
      } catch {
        return [];
      }
    }
    if (carga && descarga) {
      return [
        [carga.lat, carga.lng],
        [descarga.lat, descarga.lng],
      ];
    }
    return [];
  }, [geometria, carga, descarga]);

  const todosPontos = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    if (carga) pts.push([carga.lat, carga.lng]);
    if (descarga) pts.push([descarga.lat, descarga.lng]);
    if (lancamento) pts.push([lancamento.lat, lancamento.lng]);
    if (traçado.length) pts.push(...traçado);
    return pts;
  }, [carga, descarga, lancamento, traçado]);

  if (todosPontos.length === 0) return null;

  const center: [number, number] = todosPontos[0]!;
  const ehFallbackReta = !geometria && traçado.length > 0;

  const gmaps =
    carga && descarga
      ? `https://www.google.com/maps/dir/?api=1&origin=${carga.lat},${carga.lng}&destination=${descarga.lat},${descarga.lng}`
      : lancamento
        ? `https://www.google.com/maps?q=${lancamento.lat},${lancamento.lng}`
        : null;

  return (
    <div className="space-y-2">
      <div className="h-72 overflow-hidden rounded-md border">
        <MapContainer
          center={center}
          zoom={12}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {traçado.length >= 2 && (
            <Polyline
              positions={traçado}
              color={ehFallbackReta ? "#94a3b8" : "#ea580c"}
              weight={ehFallbackReta ? 3 : 4}
              dashArray={ehFallbackReta ? "6, 8" : undefined}
            />
          )}
          {carga && (
            <Marker position={[carga.lat, carga.lng]} icon={ICONE_CARGA}>
              <Popup>Carga: {carga.nome ?? "—"}</Popup>
            </Marker>
          )}
          {descarga && (
            <Marker position={[descarga.lat, descarga.lng]} icon={ICONE_DESCARGA}>
              <Popup>Descarga: {descarga.nome ?? "—"}</Popup>
            </Marker>
          )}
          {lancamento && (
            <Marker position={[lancamento.lat, lancamento.lng]} icon={ICONE_LANCAMENTO}>
              <Popup>Onde foi lançada</Popup>
            </Marker>
          )}
          <FitBounds pontos={todosPontos} />
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Legenda cor="#16a34a" label="Carga" />
          <Legenda cor="#dc2626" label="Descarga" />
          {lancamento && <Legenda cor="#2563eb" label="Lançamento" />}
          {ehFallbackReta && <span className="italic">(linha estimada)</span>}
        </div>
        {gmaps && (
          <a
            href={gmaps}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-blue-600 hover:underline"
          >
            Abrir no Google Maps <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function Legenda({ cor, label }: { cor: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: cor }}
      />
      {label}
    </span>
  );
}
