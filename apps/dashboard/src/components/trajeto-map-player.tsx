"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Crosshair, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Fix dos icons do leaflet com bundlers Next (mesmo do trajeto-map.tsx)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Marker laranja pro ponto atual (DivIcon — sem assets externos)
const currentIcon = L.divIcon({
  className: "",
  html: `<div style="
    width: 18px; height: 18px;
    background: #ea580c;
    border: 3px solid white;
    border-radius: 50%;
    box-shadow: 0 0 0 2px #ea580c, 0 2px 8px rgba(0,0,0,0.3);
  "></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export type PontoPlayer = {
  lat: number;
  lng: number;
  capturadoEm: string;
  velocidade?: number | null;
  precisao?: number | null;
};

const SPEEDS = [1, 10, 60, 300] as const;
type Speed = (typeof SPEEDS)[number];

function PanToCurrent({
  position,
  trigger,
}: {
  position: [number, number];
  trigger: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (trigger === 0) return;
    map.panTo(position, { animate: true, duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

export function TrajetoMapPlayer({ pontos }: { pontos: PontoPlayer[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [panTrigger, setPanTrigger] = useState(0);

  if (pontos.length < 2) return null;

  const lastIndex = pontos.length - 1;
  const inicio = pontos[0]!;
  const fim = pontos[lastIndex]!;
  const atual = pontos[currentIndex]!;

  // Animação: a cada 33ms (~30fps), avança N pontos baseado na velocidade.
  // Assume densidade de ~1 ponto/segundo de viagem; speed=60× ⇒ 2 pontos/frame
  // (60 pontos/s) — 1h de viagem em 1min de playback.
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentIndex((i) => {
        const step = Math.max(1, Math.round(speed / 30));
        const next = i + step;
        if (next >= lastIndex) {
          setIsPlaying(false);
          return lastIndex;
        }
        return next;
      });
    }, 33);
    return () => clearInterval(interval);
  }, [isPlaying, speed, lastIndex]);

  function togglePlay() {
    if (currentIndex >= lastIndex) setCurrentIndex(0);
    setIsPlaying((p) => !p);
  }

  function reset() {
    setIsPlaying(false);
    setCurrentIndex(0);
  }

  function centralizar() {
    setPanTrigger((n) => n + 1);
  }

  // Bounds no MapContainer: nasce enquadrado (sem a dupla-onda de tiles do fit).
  const bounds = useMemo(
    () => L.latLngBounds(pontos.map((p) => [p.lat, p.lng] as [number, number])),
    [pontos],
  );

  const percorrida = useMemo(
    () =>
      pontos.slice(0, currentIndex + 1).map((p) => [p.lat, p.lng] as [number, number]),
    [pontos, currentIndex],
  );
  const restante = useMemo(
    () =>
      pontos.slice(currentIndex).map((p) => [p.lat, p.lng] as [number, number]),
    [pontos, currentIndex],
  );

  const inicioTs = new Date(inicio.capturadoEm).getTime();
  const atualTs = new Date(atual.capturadoEm).getTime();
  const decorridoMin = Math.max(0, Math.round((atualTs - inicioTs) / 60_000));
  const velocidadeKmh =
    typeof atual.velocidade === "number" && atual.velocidade >= 0
      ? atual.velocidade * 3.6
      : null;

  return (
    <div className="space-y-3">
      <div className="h-80 overflow-hidden rounded-lg border">
        <MapContainer
          bounds={bounds}
          boundsOptions={{ padding: [40, 40], maxZoom: 16 }}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {/* Linha já percorrida — sólida laranja */}
          {percorrida.length >= 2 && (
            <Polyline positions={percorrida} color="#ea580c" weight={4} />
          )}
          {/* Linha ainda não percorrida — cinza tracejada */}
          {restante.length >= 2 && (
            <Polyline
              positions={restante}
              color="#cbd5e1"
              weight={3}
              dashArray="5, 8"
            />
          )}
          {/* Markers fixos: início e fim */}
          <Marker position={[inicio.lat, inicio.lng]}>
            <Popup>Início — {fmtHora(inicio.capturadoEm)}</Popup>
          </Marker>
          <Marker position={[fim.lat, fim.lng]}>
            <Popup>Fim — {fmtHora(fim.capturadoEm)}</Popup>
          </Marker>
          {/* Marker da posição atual no playback */}
          <Marker position={[atual.lat, atual.lng]} icon={currentIcon} />
          <PanToCurrent
            position={[atual.lat, atual.lng]}
            trigger={panTrigger}
          />
        </MapContainer>
      </div>

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={togglePlay}
          variant={isPlaying ? "outline" : "default"}
        >
          {isPlaying ? (
            <>
              <Pause className="h-4 w-4" />
              Pausar
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              {currentIndex >= lastIndex ? "Reiniciar" : "Reproduzir"}
            </>
          )}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={reset}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={centralizar}
          title="Centralizar mapa no marker atual"
        >
          <Crosshair className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Velocidade:</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                speed === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/70"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-muted-foreground">
          Ponto {currentIndex + 1} / {pontos.length}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={lastIndex}
        value={currentIndex}
        onChange={(e) => {
          setIsPlaying(false);
          setCurrentIndex(Number(e.target.value));
        }}
        className="w-full accent-orange-500"
      />

      {/* Info do ponto atual */}
      <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 text-xs md:grid-cols-4">
        <Info label="Hora" value={fmtHoraSeg(atual.capturadoEm)} />
        <Info label="Decorrido" value={fmtDuracao(decorridoMin)} />
        <Info
          label="Velocidade"
          value={
            velocidadeKmh !== null
              ? `${velocidadeKmh.toFixed(1)} km/h`
              : "—"
          }
        />
        <Info
          label="Precisão GPS"
          value={
            typeof atual.precisao === "number" ? `${atual.precisao.toFixed(0)} m` : "—"
          }
        />
        <div className="col-span-2 md:col-span-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Posição
          </p>
          <p className="font-mono text-xs">
            {atual.lat.toFixed(6)}, {atual.lng.toFixed(6)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function fmtHoraSeg(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function fmtDuracao(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min - h * 60;
  return `${h}h ${m.toString().padStart(2, "0")}min`;
}
