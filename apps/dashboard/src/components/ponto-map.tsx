"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import Supercluster from "supercluster";
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
  status?: string;
  /**
   * "descarga" = posição real do clique "Estou na descarga" (em cima do local).
   * "abertura" = fallback: GPS de quando o lançamento foi aberto (viagem antiga
   * sem captura de descarga) — pode cair longe do local.
   */
  origem?: "descarga" | "abertura";
  /** Texto curto pro popup: "data · ticket". */
  label?: string;
  /** Distância em linha reta até o local (m). */
  distanciaMetros?: number;
  /** Link pra abrir a viagem. */
  href?: string;
};

// Cor da bolinha por status da viagem (mesmas cores dos badges do dashboard).
const COR_STATUS: Record<string, string> = {
  OK: "#16a34a",
  DIVERGENTE: "#dc2626",
  AJUSTADA: "#2563eb",
  EM_CONFERENCIA: "#9333ea",
  ENVIADA: "#d97706",
  RASCUNHO_OFFLINE: "#64748b",
};
const LABEL_STATUS: Record<string, string> = {
  OK: "OK",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
  EM_CONFERENCIA: "Em conferência",
  ENVIADA: "Aguardando",
  RASCUNHO_OFFLINE: "Rascunho",
};
function corDe(status?: string): string {
  return (status && COR_STATUS[status]) || "#2563eb";
}
function labelStatusDe(status?: string): string {
  return (status && LABEL_STATUS[status]) || status || "—";
}

function iconeDot(cor: string, origem?: "descarga" | "abertura"): L.DivIcon {
  // Fallback de abertura: bolinha vazada (só contorno) pra deixar claro que não
  // é a posição real da descarga.
  const estilo =
    origem === "abertura"
      ? `background:white;border:2px dashed ${cor};`
      : `background:${cor};border:2px solid white;`;
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;${estilo}border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.35);"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function iconeCluster(count: number): L.DivIcon {
  const size = count < 10 ? 32 : count < 100 ? 40 : 48;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;background:rgba(37,99,235,0.85);color:white;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;font-family:system-ui;box-shadow:0 1px 6px rgba(0,0,0,0.4);">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

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

function MarcadorLancamento({ p }: { p: PontoLancamento }) {
  return (
    <Marker position={[p.lat, p.lng]} icon={iconeDot(corDe(p.status), p.origem)}>
      <Popup>
        <div className="space-y-1 text-sm">
          {p.label && <p className="font-medium">{p.label}</p>}
          <p>
            Status:{" "}
            <span style={{ color: corDe(p.status), fontWeight: 600 }}>
              {labelStatusDe(p.status)}
            </span>
          </p>
          {p.origem === "abertura" ? (
            <p className="text-xs text-amber-600">
              Posição de abertura do lançamento (sem GPS de descarga)
              {p.distanciaMetros != null && ` · ${p.distanciaMetros} m do local`}.
            </p>
          ) : (
            p.distanciaMetros != null && (
              <p className="text-xs text-muted-foreground">
                {p.distanciaMetros} m do local (linha reta)
              </p>
            )
          )}
          {p.href && (
            <a href={p.href} className="text-xs text-blue-600 hover:underline">
              Abrir viagem →
            </a>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

// Renderiza os pontos agrupados por zoom/área via supercluster. Recalcula a
// cada move/zoom. Clicar num cluster dá zoom até ele expandir.
function CamadaCluster({ pontos }: { pontos: PontoLancamento[] }) {
  const map = useMap();
  const [, setTick] = useState(0);
  useMapEvents({
    moveend: () => setTick((t) => t + 1),
    zoomend: () => setTick((t) => t + 1),
  });

  const index = useMemo(() => {
    const sc = new Supercluster<{ ponto: PontoLancamento }>({
      radius: 60,
      maxZoom: 18,
    });
    sc.load(
      pontos.map((p) => ({
        type: "Feature" as const,
        properties: { ponto: p },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    );
    return sc;
  }, [pontos]);

  const b = map.getBounds();
  const zoom = Math.round(map.getZoom());
  const clusters = index.getClusters(
    [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    zoom,
  );

  return (
    <>
      {clusters.map((c) => {
        const [lng, lat] = c.geometry.coordinates as [number, number];
        if ("cluster" in c.properties && c.properties.cluster) {
          const count = c.properties.point_count;
          const cid = c.properties.cluster_id;
          return (
            <Marker
              key={`c${cid}`}
              position={[lat, lng]}
              icon={iconeCluster(count)}
              eventHandlers={{
                click: () => {
                  const z = Math.min(index.getClusterExpansionZoom(cid), 18);
                  map.setView([lat, lng], z);
                },
              }}
            />
          );
        }
        const p = c.properties.ponto;
        return <MarcadorLancamento key={p.id} p={p} />;
      })}
    </>
  );
}

export function PontoMap({
  lat,
  lng,
  label,
  precisao,
  pontos = [],
}: {
  lat: number;
  lng: number;
  label?: string;
  /** Precisão do GPS no cadastro (m) — desenha um círculo de raio em volta. */
  precisao?: number | null;
  /** Pontos de lançamento das viagens — bolinhas coloridas por status. */
  pontos?: PontoLancamento[];
}) {
  const [usarCluster, setUsarCluster] = useState(false);
  const todos: [number, number][] = [
    [lat, lng],
    ...pontos.map((p) => [p.lat, p.lng] as [number, number]),
  ];

  return (
    <div className="relative h-64 overflow-hidden rounded-lg border">
      {pontos.length > 1 && (
        <button
          type="button"
          onClick={() => setUsarCluster((v) => !v)}
          className="absolute right-2 top-2 z-[1000] rounded-md border bg-background/95 px-2 py-1 text-xs font-medium shadow-sm hover:bg-muted"
        >
          Clusters: {usarCluster ? "Sim" : "Não"}
        </button>
      )}
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
        {precisao != null && precisao > 0 && (
          <Circle
            center={[lat, lng]}
            radius={precisao}
            pathOptions={{ color: "#2563eb", weight: 1, fillOpacity: 0.08 }}
          />
        )}
        {usarCluster ? (
          <CamadaCluster pontos={pontos} />
        ) : (
          pontos.map((p) => <MarcadorLancamento key={p.id} p={p} />)
        )}
        <Marker position={[lat, lng]}>
          <Popup>
            <div className="space-y-1 text-sm">
              {label && <p className="font-medium">{label}</p>}
              {precisao != null && (
                <p className="text-xs text-muted-foreground">
                  GPS do cadastro: ±{Math.round(precisao)} m
                </p>
              )}
            </div>
          </Popup>
        </Marker>
        <FitBounds pontos={todos} />
      </MapContainer>
    </div>
  );
}
