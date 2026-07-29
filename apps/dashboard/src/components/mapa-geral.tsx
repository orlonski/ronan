"use client";

import Link from "next/link";
import { Permitido } from "@/components/requer-tela";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapaFrotaItem } from "@ronan/shared-types";
import type { LocalMapa } from "@/components/mapa-locais";
import type { PedagioMapa } from "@/components/mapa-frota";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const CENTRO_DEFAULT: [number, number] = [-25.0945, -50.1619]; // Ponta Grossa/PR
const ZOOM_DEFAULT = 11;

// === Ícones ===
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

const ICONE_PEDAGIO = L.divIcon({
  className: "",
  html: `<div style="
    width: 22px; height: 22px;
    background: #ea580c;
    color: white;
    border: 2px solid white;
    border-radius: 4px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 11px; font-family: system-ui;
  ">$</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

type TipoLocal = "CARGA" | "DESCARGA" | "AMBOS";
const COR_LOCAL: Record<TipoLocal, string> = {
  CARGA: "#16a34a",
  DESCARGA: "#dc2626",
  AMBOS: "#7c3aed",
};
const LABEL_LOCAL: Record<TipoLocal, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  AMBOS: "Carga e descarga",
};

function pinoLocal(cor: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="
      width:22px;height:22px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${cor};
      border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -20],
  });
}
const ICONE_LOCAL: Record<TipoLocal, L.DivIcon> = {
  CARGA: pinoLocal(COR_LOCAL.CARGA),
  DESCARGA: pinoLocal(COR_LOCAL.DESCARGA),
  AMBOS: pinoLocal(COR_LOCAL.AMBOS),
};

// === Helpers ===
function iniciais(nome: string): string {
  const parts = nome.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
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

/**
 * Re-fit do mapa quando o conjunto de pontos visíveis mudar (count diferente).
 * Não refit em cada render pra não tirar o foco do admin que estiver navegando.
 */
function FitBounds({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  const lastCount = useRef(0);
  useEffect(() => {
    if (pontos.length === 0) return;
    if (pontos.length === lastCount.current) return;
    lastCount.current = pontos.length;
    if (pontos.length === 1) {
      map.setView(pontos[0]!, 13);
      return;
    }
    map.fitBounds(L.latLngBounds(pontos), { padding: [50, 50], maxZoom: 14 });
  }, [pontos, map]);
  return null;
}

export function MapaGeral({
  motoristas,
  locais,
  pedagios,
}: {
  motoristas: MapaFrotaItem[];
  locais: LocalMapa[];
  pedagios: PedagioMapa[];
}) {
  const locaisComCoord = locais.filter(
    (l): l is LocalMapa & { lat: number; lng: number } =>
      l.lat != null && l.lng != null,
  );

  const pontos: [number, number][] = [
    ...motoristas.map((m) => [m.ultimaPosicao.lat, m.ultimaPosicao.lng] as [number, number]),
    ...locaisComCoord.map((l) => [l.lat, l.lng] as [number, number]),
    ...pedagios.map((p) => [p.lat, p.lng] as [number, number]),
  ];

  return (
    <div className="h-[70vh] w-full overflow-hidden rounded-lg border bg-muted">
      <MapContainer
        center={CENTRO_DEFAULT}
        zoom={ZOOM_DEFAULT}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds pontos={pontos} />

        {motoristas.map((m) => (
          <Marker
            key={`m-${m.motorista.id}`}
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

        {locaisComCoord.map((l) => (
          <Marker
            key={`l-${l.id}`}
            position={[l.lat, l.lng]}
            icon={ICONE_LOCAL[l.tipo as TipoLocal] ?? ICONE_LOCAL.AMBOS}
          >
            <Popup>
              <div className="min-w-[200px] space-y-1.5 text-sm">
                <p className="font-semibold leading-tight">{l.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {l.logradouro}
                  {l.numero ? `, ${l.numero}` : ""}
                  <br />
                  {l.cidade}/{l.uf}
                </p>
                <p className="text-xs">
                  <span className="text-muted-foreground">Tipo: </span>
                  <span className="font-medium">
                    {LABEL_LOCAL[l.tipo as TipoLocal] ?? l.tipo}
                  </span>
                </p>
                <Permitido chave="locais.editar">
                  <Link
                    href={`/locais/${l.id}`}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Editar →
                  </Link>
                </Permitido>
              </div>
            </Popup>
          </Marker>
        ))}

        {pedagios.map((p) => (
          <Marker key={`p-${p.id}`} position={[p.lat, p.lng]} icon={ICONE_PEDAGIO}>
            <Popup>
              <div className="space-y-1 text-sm">
                <p className="font-bold">{p.nome}</p>
                {p.rodovia && <p className="text-xs">{p.rodovia}</p>}
                {p.concessionaria && (
                  <p className="text-xs text-muted-foreground">{p.concessionaria}</p>
                )}
                <Permitido chave="pedagios.editar">
                  <Link
                    href={`/pedagios-rodovia/${p.id}`}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Ver / editar →
                  </Link>
                </Permitido>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
