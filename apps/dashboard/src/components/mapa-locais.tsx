"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Permitido } from "@/components/requer-tela";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fmtBR } from "@/lib/fechamento-helpers";

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";

export type LocalMapa = {
  id: string;
  nome: string;
  logradouro: string;
  numero: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  tipo: Tipo;
  lat: number | null;
  lng: number | null;
  clientes: { id: string; nome: string }[];
  // Extras exibidos no popup (só no modo normal; ausentes no modo suspeitos).
  nivelConfianca?: string;
  origemCadastro?: string | null;
  criadoEm?: string;
  criadoPorNome?: string | null;
  viagensCarga?: number;
  viagensDescarga?: number;
};

// Label + cor do nível de confiança (mesma régua da tela "Em validação").
const NIVEL_LABEL: Record<string, { label: string; cls: string }> = {
  RASCUNHO: { label: "Rascunho", cls: "bg-zinc-100 text-zinc-700" },
  PRESENCA_PONTUAL: { label: "Presença GPS", cls: "bg-blue-100 text-blue-700" },
  DWELL_CONFIRMADO: { label: "Dwell ≥10min", cls: "bg-amber-100 text-amber-700" },
  RECORRENTE: { label: "Recorrente", cls: "bg-emerald-100 text-emerald-700" },
  HUMANO: { label: "Homologado", cls: "bg-emerald-200 text-emerald-800" },
};

// Label da origem do cadastro (mesma da listagem de locais).
const ORIGEM_LABEL: Record<string, string> = {
  MOTORISTA_FORMULARIO: "Motorista",
  MOTORISTA_RAPIDO: "Motorista (rápido)",
  VIAGEM_OFFLINE: "Viagem offline",
  ADMIN_MANUAL: "Admin",
  ADMIN_AUDITORIA: "Admin (auditoria)",
};

/** Ponto de um grupo suspeito no mapa (principal a manter vs candidato a duplicado). */
export type GrupoLocalPonto = {
  id: string;
  nome: string;
  lat: number | null;
  lng: number | null;
  papel: "principal" | "candidato";
};

export type GrupoSuspeitoMapa = {
  id: string;
  numero: number;
  centroide: { lat: number; lng: number };
  pontos: GrupoLocalPonto[];
};

// Cores por tipo. Mesmas usadas na legenda.
const COR_POR_TIPO: Record<Tipo, string> = {
  CARGA: "#16a34a",     // verde
  DESCARGA: "#dc2626",  // vermelho
  AMBOS: "#2563eb",     // azul
};

const LABEL_POR_TIPO: Record<Tipo, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  AMBOS: "Carga e descarga",
};

function pinIcon(cor: string) {
  return L.divIcon({
    html: `<div style="
      width:24px;height:24px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${cor};
      border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
    ">
      <div style="
        width:8px;height:8px;border-radius:50%;
        background:#fff;
        transform:rotate(45deg);
      "></div>
    </div>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -22],
  });
}

const ICONES: Record<Tipo, L.DivIcon> = {
  CARGA: pinIcon(COR_POR_TIPO.CARGA),
  DESCARGA: pinIcon(COR_POR_TIPO.DESCARGA),
  AMBOS: pinIcon(COR_POR_TIPO.AMBOS),
};

// Pino em DESTAQUE (busca/foco): maior, com halo âmbar, pra saltar entre os demais.
function pinDestaque(cor: string) {
  return L.divIcon({
    html: `<div style="
      width:32px;height:32px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${cor};
      border:3px solid #f59e0b;
      box-shadow:0 0 0 5px rgba(245,158,11,0.35),0 3px 10px rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;
    ">
      <div style="width:11px;height:11px;border-radius:50%;background:#fff;transform:rotate(45deg);"></div>
    </div>`,
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -30],
  });
}

const ICONE_DESTAQUE: Record<Tipo, L.DivIcon> = {
  CARGA: pinDestaque(COR_POR_TIPO.CARGA),
  DESCARGA: pinDestaque(COR_POR_TIPO.DESCARGA),
  AMBOS: pinDestaque(COR_POR_TIPO.AMBOS),
};
// Coordenada crua (busca por lat/lng, sem local casado): pino âmbar avulso.
const ICONE_COORD = pinDestaque("#f59e0b");

// Centro default = Curitiba (projeto regional do amigo). Auto-fit
// sobrescreve isso quando há locais.
const CENTRO_DEFAULT: [number, number] = [-25.4284, -49.2733];
const ZOOM_DEFAULT = 11;

function FitBounds({ locais }: { locais: LocalMapa[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = locais
      .filter((l): l is LocalMapa & { lat: number; lng: number } =>
        l.lat != null && l.lng != null,
      )
      .map((l) => [l.lat, l.lng] as [number, number]);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      const p = pts[0]!;
      map.setView(p, 15);
      return;
    }
    const bounds = L.latLngBounds(pts);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [locais, map]);
  return null;
}

/** Marcador de local dentro de um grupo suspeito: anel verde (principal) ou
 *  vermelho (candidato), com o número do caso. */
function grupoIcon(papel: "principal" | "candidato", numero: number) {
  const cor = papel === "principal" ? "#16a34a" : "#dc2626";
  return L.divIcon({
    html: `<div style="
      width:26px;height:26px;border-radius:50%;
      background:#fff;border:3px solid ${cor};
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      font:700 12px system-ui;color:${cor};
    ">${numero}</div>`,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

/** Centraliza o mapa num caso quando o admin clica no painel. */
function FocarGrupo({ foco }: { foco: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (foco) map.setView([foco.lat, foco.lng], 17, { animate: true });
  }, [foco, map]);
  return null;
}

function Legenda() {
  return (
    <div className="absolute right-3 top-3 z-[400] rounded-md border bg-background/95 p-2 shadow-md backdrop-blur">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Tipo
      </p>
      <ul className="space-y-1">
        {(Object.keys(LABEL_POR_TIPO) as Tipo[]).map((t) => (
          <li key={t} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: COR_POR_TIPO[t] }}
            />
            {LABEL_POR_TIPO[t]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MapaLocais({
  locais,
  loading,
  gruposSuspeitos,
  raioSuspeitoM,
  foco,
  focoId,
}: {
  locais: LocalMapa[];
  loading?: boolean;
  /** Quando presente e não-vazio, entra em "modo suspeitos": destaca os grupos. */
  gruposSuspeitos?: GrupoSuspeitoMapa[];
  /** Raio (m) do círculo de agrupamento desenhado por caso. */
  raioSuspeitoM?: number;
  /** Centro pra focar (caso suspeito, local buscado ou lat/lng informado). */
  foco?: { lat: number; lng: number; nome?: string } | null;
  /** Id do local buscado — destaca o pino dele; null = marcador avulso no `foco`. */
  focoId?: string | null;
}) {
  const pontos = useMemo(
    () =>
      locais.filter(
        (l): l is LocalMapa & { lat: number; lng: number } =>
          l.lat != null && l.lng != null,
      ),
    [locais],
  );
  const modoSuspeitos = !!gruposSuspeitos && gruposSuspeitos.length > 0;
  const pontosSuspeitos = useMemo(
    () =>
      (gruposSuspeitos ?? []).flatMap((g) =>
        g.pontos
          .filter((p): p is GrupoLocalPonto & { lat: number; lng: number } => p.lat != null && p.lng != null)
          .map((p) => ({ ...p, numero: g.numero })),
      ),
    [gruposSuspeitos],
  );
  // No modo suspeitos, enquadra nos pontos dos grupos; senão nos locais normais.
  const pontosFit: LocalMapa[] = modoSuspeitos
    ? pontosSuspeitos.map((p) => ({
        id: p.id,
        nome: p.nome,
        logradouro: "",
        numero: null,
        bairro: null,
        cidade: "",
        uf: "",
        tipo: "DESCARGA" as Tipo,
        lat: p.lat,
        lng: p.lng,
        clientes: [],
      }))
    : pontos;

  return (
    <div className="relative h-[calc(100vh-260px)] min-h-[500px] overflow-hidden rounded-lg border">
      {loading && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">Carregando locais…</p>
        </div>
      )}
      <MapContainer
        center={CENTRO_DEFAULT}
        zoom={ZOOM_DEFAULT}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {!foco && <FitBounds locais={pontosFit} />}
        <FocarGrupo foco={foco ?? null} />
        {/* Modo suspeitos: círculo por caso + marcadores anel verde/vermelho. */}
        {modoSuspeitos &&
          gruposSuspeitos!.map((g) => (
            <Circle
              key={`c-${g.id}`}
              center={[g.centroide.lat, g.centroide.lng]}
              radius={raioSuspeitoM ?? 200}
              pathOptions={{ color: "#dc2626", weight: 1, fillColor: "#dc2626", fillOpacity: 0.06 }}
            />
          ))}
        {modoSuspeitos &&
          pontosSuspeitos.map((p) => (
            <Marker key={`s-${p.id}`} position={[p.lat, p.lng]} icon={grupoIcon(p.papel, p.numero)}>
              <Popup>
                <div className="min-w-[180px] space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Caso {p.numero} · {p.papel === "principal" ? "Principal (manter)" : "Candidato a duplicado"}
                  </p>
                  <p className="font-semibold leading-tight">{p.nome}</p>
                  <Permitido chave="locais.editar">
                    <Link href={`/locais/${p.id}`} className="text-xs font-medium text-blue-700 hover:underline">
                      Abrir local →
                    </Link>
                  </Permitido>
                </div>
              </Popup>
            </Marker>
          ))}
        {!modoSuspeitos &&
          pontos.map((l) => (
          <Marker
            key={l.id}
            position={[l.lat, l.lng]}
            icon={focoId && l.id === focoId ? ICONE_DESTAQUE[l.tipo] : ICONES[l.tipo]}
            zIndexOffset={focoId && l.id === focoId ? 1000 : 0}
          >
            <Popup>
              <div className="min-w-[200px] space-y-1.5">
                <p className="font-semibold leading-tight">{l.nome}</p>
                <p className="text-xs leading-snug text-muted-foreground">
                  {l.logradouro}
                  {l.numero ? `, ${l.numero}` : ""}
                  {l.bairro ? ` — ${l.bairro}` : ""}
                  <br />
                  {l.cidade}/{l.uf}
                </p>
                <p className="text-xs">
                  <span className="text-muted-foreground">Tipo: </span>
                  <span className="font-medium">{LABEL_POR_TIPO[l.tipo]}</span>
                </p>
                <p className="text-xs">
                  <span className="text-muted-foreground">Cliente: </span>
                  {l.clientes.length === 0
                    ? "—"
                    : l.clientes.map((c) => c.nome).join(", ")}
                </p>
                <p className="text-xs">
                  <span className="text-muted-foreground">Viagens: </span>
                  <span className="font-medium">
                    {(l.viagensCarga ?? 0) + (l.viagensDescarga ?? 0)}
                  </span>
                  {(l.viagensCarga ?? 0) + (l.viagensDescarga ?? 0) > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({l.viagensCarga ?? 0} carga · {l.viagensDescarga ?? 0} descarga)
                    </span>
                  )}
                </p>
                {l.nivelConfianca && NIVEL_LABEL[l.nivelConfianca] && (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Nível: </span>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${NIVEL_LABEL[l.nivelConfianca]!.cls}`}
                    >
                      {NIVEL_LABEL[l.nivelConfianca]!.label}
                    </span>
                  </p>
                )}
                <p className="text-xs leading-snug">
                  <span className="text-muted-foreground">Cadastro: </span>
                  {l.origemCadastro
                    ? (ORIGEM_LABEL[l.origemCadastro] ?? l.origemCadastro)
                    : "—"}
                  {l.criadoPorNome ? ` · ${l.criadoPorNome}` : ""}
                  {l.criadoEm ? ` · ${fmtBR(l.criadoEm)}` : ""}
                </p>
                <div className="pt-1">
                  <Permitido chave="locais.editar">
                    <Link
                      href={`/locais/${l.id}`}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Editar →
                    </Link>
                  </Permitido>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
        {/* Marcador avulso do foco: busca por lat/lng, ou local que não está
            entre os pinos desenhados (filtrado / fora da view atual). */}
        {!modoSuspeitos && foco && !focoId && (
          <Marker position={[foco.lat, foco.lng]} icon={ICONE_COORD} zIndexOffset={1000}>
            <Popup>
              <div className="min-w-[160px] space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  Em destaque
                </p>
                <p className="font-semibold leading-tight">{foco.nome ?? "Coordenada"}</p>
                <p className="text-xs text-muted-foreground">
                  {foco.lat.toFixed(5)}, {foco.lng.toFixed(5)}
                </p>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
      {!modoSuspeitos && <Legenda />}
    </div>
  );
}
