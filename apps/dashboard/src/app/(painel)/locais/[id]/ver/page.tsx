"use client";

import { use } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MapPin, Pencil, Truck, User } from "lucide-react";
import type { FonteGps } from "@ronan/shared-types";
import { FormPageHeader } from "@/components/form-page-header";
import { Permitido } from "@/components/requer-tela";
import { FotoLocal } from "@/components/foto-local";
import { SinalGpsBadge } from "@/components/sinal-gps-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { fmtBR } from "@/lib/fechamento-helpers";
import { fetchApi, useAuthToken, useResourceItem } from "@/lib/client-api";
import { ViagensDoLocal } from "../../_components/viagens-do-local";

const PontoMap = dynamic(
  () => import("@/components/ponto-map").then((m) => m.PontoMap),
  { ssr: false, loading: () => <div className="h-64 rounded-lg border bg-muted/30" /> },
);

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";
type Nivel =
  | "RASCUNHO"
  | "PRESENCA_PONTUAL"
  | "DWELL_CONFIRMADO"
  | "RECORRENTE"
  | "HUMANO";
type Origem =
  | "MOTORISTA_FORMULARIO"
  | "MOTORISTA_RAPIDO"
  | "VIAGEM_OFFLINE"
  | "ADMIN_MANUAL"
  | "ADMIN_AUDITORIA";

type Local = {
  id: string;
  nome: string;
  logradouro: string;
  numero: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  pontoReferencia: string | null;
  tipo: Tipo;
  ativo: boolean;
  lat: number | null;
  lng: number | null;
  latLngPrecisao: number | null;
  latLngFonte: FonteGps | null;
  nivelConfianca: Nivel;
  origemCadastro: Origem | null;
  totalViagens: number;
  clientes: { id: string; nome: string }[];
  criadoPor: { id: string; nome: string } | null;
  criadoPorMotorista: { id: string; nome: string } | null;
};

const TIPO_LOCAL_COLOR: Record<Tipo, string> = {
  CARGA: "border-emerald-200 bg-emerald-50 text-emerald-900",
  DESCARGA: "border-rose-200 bg-rose-50 text-rose-900",
  AMBOS: "border-violet-200 bg-violet-50 text-violet-900",
};

const NIVEL_LABEL: Record<Nivel, { label: string; cls: string }> = {
  RASCUNHO: { label: "Rascunho", cls: "bg-zinc-100 text-zinc-700" },
  PRESENCA_PONTUAL: { label: "Presença GPS", cls: "bg-blue-100 text-blue-700" },
  DWELL_CONFIRMADO: { label: "Dwell ≥10min", cls: "bg-amber-100 text-amber-700" },
  RECORRENTE: { label: "Recorrente", cls: "bg-emerald-100 text-emerald-700" },
  HUMANO: { label: "Homologado", cls: "bg-emerald-200 text-emerald-800" },
};

const ORIGEM_LABEL: Record<Origem, string> = {
  MOTORISTA_FORMULARIO: "Motorista",
  MOTORISTA_RAPIDO: "Motorista (rápido)",
  VIAGEM_OFFLINE: "Viagem offline",
  ADMIN_MANUAL: "Admin",
  ADMIN_AUDITORIA: "Admin (auditoria)",
};

// Distância em linha reta (Haversine) em metros.
function distanciaMetros(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function InfoLinha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export default function VisualizarLocalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Local>("/admin/locais", id);
  const l = item.data;

  // Limite de sinal fraco configurável — marca o GPS do cadastro em âmbar.
  const token = useAuthToken();
  const gpsConfig = useQuery({
    queryKey: ["busca-locais-config"],
    enabled: !!token,
    staleTime: 30 * 60_000,
    queryFn: () =>
      fetchApi<{ gpsLimiteSinalFracoM: number }>("/admin/busca-locais-config", { token }),
  });
  const limiteSinalFraco = gpsConfig.data?.gpsLimiteSinalFracoM ?? 50;

  // Pontos de lançamento das viagens que descarregaram neste local.
  const lancamentos = useQuery({
    queryKey: ["local-lancamentos", id],
    enabled: !!token,
    staleTime: 60_000,
    queryFn: () =>
      fetchApi<{
        total: number;
        truncado: boolean;
        pontos: Array<{
          id: string;
          lat: number;
          lng: number;
          origem: "descarga" | "abertura";
          descargaDistanciaMetros: number | null;
          data: string;
          ticket: string;
          status: string;
        }>;
      }>(`/admin/locais/${id}/lancamentos`, { token }),
  });

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={l ? l.nome : "Local"}
        backHref="/locais"
        right={
          l ? (
            <Permitido chave="locais.editar">
              <Link href={`/locais/${l.id}`}>
                <Button variant="outline">
                  <Pencil className="h-4 w-4" /> Editar
                </Button>
              </Link>
            </Permitido>
          ) : undefined
        }
      />

      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}

      {l && (
        <>
          <Card className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={TIPO_LOCAL_COLOR[l.tipo] ?? ""}>{l.tipo}</Badge>
              <Badge className={NIVEL_LABEL[l.nivelConfianca]?.cls}>
                {NIVEL_LABEL[l.nivelConfianca]?.label ?? l.nivelConfianca}
              </Badge>
              {!l.ativo && (
                <Badge className="bg-zinc-100 text-zinc-600">Inativo</Badge>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoLinha rotulo="Endereço">
                {l.logradouro || "—"}
                {l.numero ? `, ${l.numero}` : ""}
                {l.bairro ? ` — ${l.bairro}` : ""}
              </InfoLinha>
              <InfoLinha rotulo="Cidade/UF">
                {l.cidade ? `${l.cidade}/${l.uf}` : "—"}
              </InfoLinha>
              <InfoLinha rotulo="CEP">{l.cep || "—"}</InfoLinha>
              <InfoLinha rotulo="Ponto de referência">
                {l.pontoReferencia || "—"}
              </InfoLinha>
              <InfoLinha rotulo="Clientes">
                {l.clientes.length
                  ? l.clientes.map((c) => c.nome).join(", ")
                  : "Genérico (todos)"}
              </InfoLinha>
              <InfoLinha rotulo="Total de viagens">
                <span className="inline-flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                  {l.totalViagens}
                </span>
              </InfoLinha>
              <InfoLinha rotulo="Origem do cadastro">
                {l.origemCadastro ? ORIGEM_LABEL[l.origemCadastro] : "—"}
              </InfoLinha>
              <InfoLinha rotulo="Criado por">
                <span className="inline-flex items-center gap-1">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {l.criadoPor?.nome ?? l.criadoPorMotorista?.nome ?? "—"}
                </span>
              </InfoLinha>
            </div>
          </Card>

          {l.lat != null && l.lng != null && (
            <Card className="space-y-3 p-6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MapPin className="h-4 w-4 text-muted-foreground" /> Localização no mapa
              </div>
              {/* Foto do ponto ao lado do mapa: o pin diz ONDE, a foto diz SE é
                  o lugar certo (portão, pátio, entrada). */}
              <div className="grid gap-4 lg:grid-cols-2">
                <FotoLocal lat={l.lat} lng={l.lng} />
                <PontoMap
                  lat={l.lat}
                  lng={l.lng}
                  label={l.nome}
                  precisao={l.latLngPrecisao}
                  pontos={(lancamentos.data?.pontos ?? []).map((p) => ({
                    id: p.id,
                    lat: p.lat,
                    lng: p.lng,
                    status: p.status,
                    origem: p.origem,
                    label: `${fmtBR(p.data)} · ${p.ticket}`,
                    // Prefere a distância que o app calculou no clique da descarga;
                    // senão (fallback de abertura) mede em linha reta.
                    distanciaMetros:
                      p.descargaDistanciaMetros ??
                      distanciaMetros(l.lat!, l.lng!, p.lat, p.lng),
                    href: `/viagens/${p.id}`,
                  }))}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Coordenadas: {l.lat.toFixed(6)}, {l.lng.toFixed(6)}.
                {lancamentos.data && lancamentos.data.pontos.length > 0 && (() => {
                  const pts = lancamentos.data.pontos;
                  const descargas = pts.filter((p) => p.origem === "descarga").length;
                  const aberturas = pts.length - descargas;
                  return (
                    <>
                      {" "}
                      <span className="text-blue-600">●</span> {descargas}{" "}
                      {descargas === 1 ? "descarga" : "descargas"} no mapa
                      {lancamentos.data.truncado && ` (de ${lancamentos.data.total} — mostrando as 500 mais recentes)`}.
                      {aberturas > 0 && (
                        <>
                          {" "}
                          <span className="text-slate-400">●</span> {aberturas}{" "}
                          {aberturas === 1 ? "viagem antiga" : "viagens antigas"} sem GPS de
                          descarga — mostro a posição de abertura do lançamento (pode não bater
                          com o local).
                        </>
                      )}
                    </>
                  );
                })()}
                {l.latLngPrecisao != null && (
                  <span className={l.latLngPrecisao > limiteSinalFraco ? "text-amber-600" : ""}>
                    {" "}
                    GPS do cadastro: ±{Math.round(l.latLngPrecisao)} m
                    {l.latLngPrecisao > limiteSinalFraco ? " (sinal fraco)" : ""}.
                  </span>
                )}
              </p>
              {(l.latLngFonte != null || l.latLngPrecisao != null) && (
                <div className="mt-2">
                  <SinalGpsBadge
                    precisao={l.latLngPrecisao}
                    fonte={l.latLngFonte}
                    limiteSinalFraco={limiteSinalFraco}
                  />
                </div>
              )}
            </Card>
          )}

          <ViagensDoLocal localId={id} totalViagens={l.totalViagens} />
        </>
      )}
    </div>
  );
}
