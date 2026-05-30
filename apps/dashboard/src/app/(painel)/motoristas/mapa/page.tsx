"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, MapPin, Users } from "lucide-react";
import type { MapaFrotaItem } from "@ronan/shared-types";
import type { PedagioMapa } from "@/components/mapa-frota";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { fetchApi, useAuthToken } from "@/lib/client-api";

// Mapa Leaflet: dynamic import pra evitar SSR (Leaflet usa window).
const MapaFrota = dynamic(
  () => import("@/components/mapa-frota").then((m) => m.MapaFrota),
  { ssr: false, loading: () => <div className="h-[70vh] rounded-lg border bg-muted/30" /> },
);

const JANELA_OPCOES = [
  { value: "15", label: "Últimos 15 min" },
  { value: "30", label: "Últimos 30 min" },
  { value: "60", label: "Última hora" },
  { value: "180", label: "Últimas 3h" },
  { value: "1440", label: "Últimas 24h" },
];

export default function MapaFrotaPage() {
  const token = useAuthToken();
  const [janela, setJanela] = useState("60");
  const [mostrarPedagios, setMostrarPedagios] = useState(false);

  const q = useQuery({
    queryKey: ["frota-mapa", janela, token],
    enabled: !!token,
    refetchInterval: 60_000, // atualiza sozinho a cada 1 min
    queryFn: () =>
      fetchApi<MapaFrotaItem[]>(`/admin/frota/mapa?janelaMinutos=${janela}`, {
        token,
      }),
  });

  // Carregado só quando admin toca no toggle — ~1000 pontos é leve mas
  // evita a request inicial se ele não se importa com pedágios.
  const qp = useQuery({
    queryKey: ["pedagios-mapa", token],
    enabled: !!token && mostrarPedagios,
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchApi<PedagioMapa[]>(`/admin/pedagios-rodovia/mapa`, { token }),
  });

  const items = q.data ?? [];
  const pedagios = mostrarPedagios ? qp.data ?? [] : [];

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <MapPin className="mt-1 h-6 w-6 text-muted-foreground" />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Onde estão os motoristas
          </h1>
          <p className="text-sm text-muted-foreground">
            Posições recentes dos motoristas que optaram por compartilhar.
            Atualiza sozinho a cada minuto.
          </p>
        </div>
      </header>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Janela
            </label>
            <Combobox
              value={janela}
              onChange={(v) => setJanela(v ?? "60")}
              options={JANELA_OPCOES}
              placeholder="Selecione"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4 text-emerald-600" />
            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-900">
              <Users className="mr-1 inline h-3 w-3" />
              {items.length} motorista{items.length === 1 ? "" : "s"} ativo
              {items.length === 1 ? "" : "s"}
            </Badge>
            {q.isFetching && (
              <span className="text-xs text-muted-foreground">atualizando…</span>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mostrarPedagios}
              onChange={(e) => setMostrarPedagios(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-orange-600"
            />
            <span className="select-none">
              Mostrar pedágios
              {mostrarPedagios && qp.data && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({qp.data.length})
                </span>
              )}
            </span>
          </label>
        </div>
      </Card>

      {q.error && (
        <Card className="p-4">
          <p className="text-sm text-red-600">
            Erro ao carregar: {(q.error as Error).message}
          </p>
        </Card>
      )}

      {!q.isLoading && items.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum motorista com posição capturada nessa janela.
          </p>
        </Card>
      )}

      <MapaFrota items={items} pedagios={pedagios} />
    </div>
  );
}
