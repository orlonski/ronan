"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MapPin,
  MousePointerClick,
  Pencil,
  Route,
  Save,
  Search,
  Sparkles,
  WifiOff,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";
import { useEventosViagem, type EventoMotorista } from "@/lib/eventos-api";

const TIPO_META: Record<
  string,
  { label: string; Icon: typeof CheckCircle2; cor: string }
> = {
  rota_calculo_iniciado: { label: "Cálculo de rota iniciado", Icon: MapPin, cor: "bg-slate-500" },
  rota_calculo_sucesso: { label: "Cálculo de rota — sucesso", Icon: CheckCircle2, cor: "bg-emerald-600" },
  rota_calculo_falhou: { label: "Cálculo de rota — falhou", Icon: XCircle, cor: "bg-red-600" },
  gps_capturado: { label: "GPS capturado", Icon: MapPin, cor: "bg-blue-600" },
  gps_falhou: { label: "GPS — falhou", Icon: AlertCircle, cor: "bg-amber-600" },
  viagem_salva: { label: "Viagem salva", Icon: Save, cor: "bg-primary" },
  // Telemetria de interação da tela "Nova viagem" (opt-in).
  nv_campo: { label: "Campo preenchido", Icon: Pencil, cor: "bg-slate-500" },
  nv_busca: { label: "Buscou na lista", Icon: Search, cor: "bg-slate-500" },
  nv_selecao: { label: "Selecionou da lista", Icon: MousePointerClick, cor: "bg-blue-600" },
  nv_descarga: { label: "Descarga (busca/escolha)", Icon: MapPin, cor: "bg-amber-600" },
  nv_ocr: { label: "OCR preencheu campos", Icon: Sparkles, cor: "bg-indigo-600" },
  nv_km: { label: "Escolheu o km", Icon: Route, cor: "bg-emerald-600" },
};

function metaPara(tipo: string) {
  return (
    TIPO_META[tipo] ?? {
      label: tipo,
      Icon: AlertCircle,
      cor: "bg-slate-400",
    }
  );
}

export function DiagnosticoViagem({ viagemId }: { viagemId: string }) {
  const eventos = useEventosViagem(viagemId);

  if (eventos.isLoading) {
    return <Card className="p-5"><p className="text-sm">Carregando…</p></Card>;
  }
  if (eventos.error) {
    return (
      <Card className="p-5">
        <p className="text-sm text-red-600">
          Erro ao carregar diagnóstico: {(eventos.error as Error).message}
        </p>
      </Card>
    );
  }
  const lista = eventos.data ?? [];
  if (lista.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="mb-2 text-base font-medium">Diagnóstico</h3>
        <p className="text-sm text-muted-foreground">
          Sem eventos de telemetria registrados pra essa viagem. (Eventos começam a chegar após a próxima viagem do motorista com app atualizado.)
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="mb-4 text-base font-medium">
        Timeline de eventos do motorista
      </h3>
      <ol className="relative space-y-3 border-l border-border pl-6">
        {lista.map((ev) => (
          <EventoItem key={ev.id} ev={ev} />
        ))}
      </ol>
    </Card>
  );
}

function EventoItem({ ev }: { ev: EventoMotorista }) {
  const [aberto, setAberto] = useState(false);
  const meta = metaPara(ev.tipo);
  const Icon = meta.Icon;
  return (
    <li className="relative">
      <span
        className={`absolute -left-[27px] top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background ${meta.cor}`}
      >
        <Icon className="h-3 w-3 text-white" />
      </span>
      <div className="rounded-md border bg-background p-3">
        <button
          type="button"
          onClick={() => setAberto((s) => !s)}
          className="flex w-full items-center gap-2 text-left text-sm"
        >
          {aberto ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">{meta.label}</span>
          {!ev.online && (
            <Badge className="border-amber-200 bg-amber-50 text-amber-700">
              <WifiOff className="mr-1 inline h-3 w-3" />
              offline
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {fmtDataHoraBR(ev.capturadoEm)}
          </span>
        </button>
        {aberto && (
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(ev.contexto, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}
