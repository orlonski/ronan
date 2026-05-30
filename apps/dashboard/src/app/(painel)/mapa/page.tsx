"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, MapPin, Users } from "lucide-react";
import type { MapaFrotaItem } from "@ronan/shared-types";
import type { PedagioMapa } from "@/components/mapa-frota";
import type { LocalMapa } from "@/components/mapa-locais";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { fetchApi, useAuthToken } from "@/lib/client-api";

const MapaGeral = dynamic(
  () => import("@/components/mapa-geral").then((m) => m.MapaGeral),
  { ssr: false, loading: () => <div className="h-[70vh] rounded-lg border bg-muted/30" /> },
);

const JANELA_OPCOES = [
  { value: "15", label: "Últimos 15 min" },
  { value: "30", label: "Últimos 30 min" },
  { value: "60", label: "Última hora" },
  { value: "180", label: "Últimas 3h" },
  { value: "1440", label: "Últimas 24h" },
];

export default function MapaGeralPage() {
  const token = useAuthToken();
  const [janela, setJanela] = useState("60");
  const [showMotoristas, setShowMotoristas] = useState(true);
  const [showLocais, setShowLocais] = useState(false);
  const [showPedagios, setShowPedagios] = useState(false);

  const qMotoristas = useQuery({
    queryKey: ["mapa-geral-motoristas", janela, token],
    enabled: !!token && showMotoristas,
    refetchInterval: showMotoristas ? 60_000 : false,
    queryFn: () =>
      fetchApi<MapaFrotaItem[]>(`/admin/frota/mapa?janelaMinutos=${janela}`, { token }),
  });

  const qLocais = useQuery({
    queryKey: ["mapa-geral-locais", token],
    enabled: !!token && showLocais,
    staleTime: 5 * 60_000,
    queryFn: () => fetchApi<LocalMapa[]>(`/admin/locais/mapa`, { token }),
  });

  const qPedagios = useQuery({
    queryKey: ["mapa-geral-pedagios", token],
    enabled: !!token && showPedagios,
    staleTime: 5 * 60_000,
    queryFn: () => fetchApi<PedagioMapa[]>(`/admin/pedagios-rodovia/mapa`, { token }),
  });

  const motoristas = showMotoristas ? qMotoristas.data ?? [] : [];
  const locais = showLocais ? qLocais.data ?? [] : [];
  const pedagios = showPedagios ? qPedagios.data ?? [] : [];

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <MapPin className="mt-1 h-6 w-6 text-muted-foreground" />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Mapa</h1>
          <p className="text-sm text-muted-foreground">
            Visão geográfica unificada. Liga/desliga camadas no topo. Motoristas
            atualizam sozinhos a cada minuto.
          </p>
        </div>
      </header>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showMotoristas}
              onChange={(e) => setShowMotoristas(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-blue-600"
            />
            <span className="select-none font-medium">Motoristas</span>
            {showMotoristas && (
              <Badge className="border-blue-200 bg-blue-50 text-blue-900">
                <Users className="mr-1 inline h-3 w-3" />
                {motoristas.length}
              </Badge>
            )}
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showLocais}
              onChange={(e) => setShowLocais(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-green-600"
            />
            <span className="select-none font-medium">Locais</span>
            {showLocais && qLocais.data && (
              <Badge className="border-green-200 bg-green-50 text-green-900">
                {qLocais.data.length}
              </Badge>
            )}
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showPedagios}
              onChange={(e) => setShowPedagios(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-orange-600"
            />
            <span className="select-none font-medium">Pedágios</span>
            {showPedagios && qPedagios.data && (
              <Badge className="border-orange-200 bg-orange-50 text-orange-900">
                {qPedagios.data.length}
              </Badge>
            )}
          </label>

          {showMotoristas && (
            <div className="min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Janela motoristas
              </label>
              <Combobox
                value={janela}
                onChange={(v) => setJanela(v ?? "60")}
                options={JANELA_OPCOES}
                placeholder="Selecione"
              />
            </div>
          )}

          {(qMotoristas.isFetching || qLocais.isFetching || qPedagios.isFetching) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Activity className="h-3 w-3" />
              atualizando…
            </div>
          )}
        </div>
      </Card>

      <MapaGeral motoristas={motoristas} locais={locais} pedagios={pedagios} />
    </div>
  );
}
