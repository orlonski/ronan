"use client";

import { useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import polylineLib from "@mapbox/polyline";
import { ExternalLink } from "lucide-react";
import type { PontoMapa } from "./mapa-comprovante";

// Fix dos icons do leaflet com bundlers Next — mesmo do mapa-trajeto-viagem.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function pino(cor: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="width:24px;height:24px;background:${cor};border:3px solid white;border-radius:50%;box-shadow:0 0 0 2px ${cor},0 2px 8px rgba(0,0,0,.3)"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}
const ICONE_ORIGEM = pino("#16a34a");
const ICONE_DESTINO = pino("#dc2626");

/**
 * Mapa enxuto do comprovante público: polilinha da rota + dois pinos.
 *
 * Deliberadamente NÃO reusa `components/mapa-trajeto-viagem`: aquele é do
 * painel e carrega popups de "copiar coordenada", pedágios e o pino de onde a
 * viagem foi lançada — superfície interna que não deve seguir o cliente. Manter
 * separado também deixa aquele evoluir sem risco de vazar coisa nova aqui.
 */
export function MapaLeaflet({
  origem,
  destino,
  geometria,
}: {
  origem: PontoMapa | null;
  destino: PontoMapa | null;
  geometria: string | null;
}) {
  const traçado = useMemo<[number, number][]>(() => {
    if (!geometria) return [];
    try {
      return polylineLib.decode(geometria) as [number, number][];
    } catch {
      return [];
    }
  }, [geometria]);

  const pontos = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = [];
    if (origem) pts.push([origem.lat, origem.lng]);
    if (destino) pts.push([destino.lat, destino.lng]);
    if (traçado.length) pts.push(...traçado);
    return pts;
  }, [origem, destino, traçado]);

  const bounds = useMemo(() => (pontos.length ? L.latLngBounds(pontos) : null), [pontos]);
  if (!bounds) return null;

  const gmaps =
    origem && destino
      ? `https://www.google.com/maps/dir/?api=1&origin=${origem.lat},${origem.lng}&destination=${destino.lat},${destino.lng}`
      : null;

  return (
    <div className="space-y-2">
      <div className="h-72 overflow-hidden rounded-md border">
        <MapContainer
          bounds={bounds}
          boundsOptions={{ padding: [40, 40], maxZoom: 15 }}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {traçado.length >= 2 && <Polyline positions={traçado} color="#ea580c" weight={4} />}
          {origem && <Marker position={[origem.lat, origem.lng]} icon={ICONE_ORIGEM} />}
          {destino && <Marker position={[destino.lat, destino.lng]} icon={ICONE_DESTINO} />}
        </MapContainer>
      </div>
      {gmaps && (
        <a
          href={gmaps}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Ver rota no Google Maps
        </a>
      )}
    </div>
  );
}
