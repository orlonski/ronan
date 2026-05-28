"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ChevronDown, ChevronRight, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { LoadingCard } from "@/components/loading";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";
import { useListarEventos, type EventoMotorista } from "@/lib/eventos-api";

const TIPO_OPCOES: { value: string; label: string }[] = [
  { value: "rota_calculo_iniciado", label: "Cálculo de rota iniciado" },
  { value: "rota_calculo_sucesso", label: "Cálculo de rota — sucesso" },
  { value: "rota_calculo_falhou", label: "Cálculo de rota — falhou" },
  { value: "gps_capturado", label: "GPS capturado" },
  { value: "gps_falhou", label: "GPS — falhou" },
  { value: "viagem_salva", label: "Viagem salva" },
];

const ONLINE_OPCOES = [
  { value: "", label: "Todos" },
  { value: "false", label: "Só offline" },
  { value: "true", label: "Só online" },
];

const TIPO_LABEL: Record<string, string> = Object.fromEntries(
  TIPO_OPCOES.map((o) => [o.value, o.label]),
);

export default function DiagnosticosPage() {
  const [tipo, setTipo] = useState<string>("");
  const [online, setOnline] = useState<string>("");

  const lista = useListarEventos({
    tipo: tipo ? [tipo] : undefined,
    online: online === "true" ? true : online === "false" ? false : undefined,
    limit: 200,
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Activity className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Diagnósticos</h1>
          <p className="text-sm text-muted-foreground">
            Telemetria de operação dos motoristas. Investigação de falhas silenciosas
            (rota não calculada, GPS, viagens offline).
          </p>
        </div>
      </header>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Tipo
            </label>
            <Combobox
              value={tipo}
              onChange={(v) => setTipo(v ?? "")}
              options={[{ value: "", label: "Todos os tipos" }, ...TIPO_OPCOES]}
              placeholder="Filtrar por tipo"
            />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Conexão
            </label>
            <Combobox
              value={online}
              onChange={(v) => setOnline(v ?? "")}
              options={ONLINE_OPCOES}
              placeholder="Online/offline"
            />
          </div>
        </div>
      </Card>

      {lista.isLoading && <LoadingCard />}
      {lista.error && (
        <Card className="p-4">
          <p className="text-sm text-red-600">
            Erro ao carregar: {(lista.error as Error).message}
          </p>
        </Card>
      )}

      {lista.data && lista.data.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Sem eventos pra esse filtro.
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {lista.data?.map((ev) => <EventoRow key={ev.id} ev={ev} />)}
      </div>
    </div>
  );
}

function EventoRow({ ev }: { ev: EventoMotorista }) {
  const [aberto, setAberto] = useState(false);
  const label = TIPO_LABEL[ev.tipo] ?? ev.tipo;
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto((s) => !s)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
      >
        {aberto ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="font-medium">{label}</span>
        {!ev.online && (
          <Badge className="border-amber-200 bg-amber-50 text-amber-700">
            <WifiOff className="mr-1 inline h-3 w-3" />
            offline
          </Badge>
        )}
        <Badge className="border-slate-200 bg-slate-50 text-slate-700">
          {ev.origem === "motorista-app" ? "Android" : "PWA"}
        </Badge>
        {ev.motorista && (
          <span className="text-sm text-muted-foreground">{ev.motorista.nome}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtDataHoraBR(ev.capturadoEm)}
        </span>
      </button>
      {aberto && (
        <div className="border-t bg-muted/30 px-4 py-3 text-xs">
          <pre className="overflow-x-auto rounded bg-background p-2">
            {JSON.stringify(ev.contexto, null, 2)}
          </pre>
          {ev.viagemId && (
            <p className="mt-2">
              <Link
                href={`/viagens/${ev.viagemId}`}
                className="font-medium text-primary underline"
              >
                Ver viagem →
              </Link>
            </p>
          )}
          {!ev.viagemId && ev.viagemClientId && (
            <p className="mt-2 text-muted-foreground">
              Viagem (clientId): <span className="font-mono">{ev.viagemClientId}</span>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
