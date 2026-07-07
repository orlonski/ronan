"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  ExternalLink,
  MapPin,
  Phone,
  RefreshCw,
  Truck,
  User,
} from "lucide-react";
import { RequerTela } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { fmtDataHoraSP } from "@/lib/datetime-br";

const PATH = "/admin/viagens-andamento";
const POLL_MS = 20_000;

type EventoAndamento = {
  id: string;
  tipoSlug: string;
  ocorridoEm: string;
  lat: number | null;
  lng: number | null;
  localId: string | null;
  toneladas: number | null;
  observacao: string | null;
};

type ViagemAndamento = {
  id: string;
  clientId: string;
  iniciadoEm: string;
  criadoOfflineEm: string | null;
  lat: number | null;
  lng: number | null;
  motorista: { id: string; nome: string; telefone: string | null };
  veiculo: { id: string; placa: string } | null;
  localCarga: { id: string; nome: string; cidade: string | null; uf: string | null } | null;
  eventosViagem: EventoAndamento[];
};

// "iniciada há X" — tempo relativo curto em PT-BR.
function tempoRelativo(desde: string, agora: number): string {
  const inicio = new Date(desde).getTime();
  if (Number.isNaN(inicio)) return "—";
  const seg = Math.max(0, Math.floor((agora - inicio) / 1000));
  if (seg < 60) return "agora mesmo";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const restoMin = min % 60;
  if (h < 24) return restoMin ? `há ${h}h${String(restoMin).padStart(2, "0")}` : `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

function fmtHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function fmtTon(v: number | null): string | null {
  if (v == null) return null;
  return `${v.toLocaleString("pt-BR")} t`;
}

function ViagemCard({ v, agora }: { v: ViagemAndamento; agora: number }) {
  const eventos = [...v.eventosViagem].sort(
    (a, b) => new Date(a.ocorridoEm).getTime() - new Date(b.ocorridoEm).getTime(),
  );

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{v.motorista.nome}</span>
          </div>
          {v.motorista.telefone && (
            <a
              href={`tel:${v.motorista.telefone}`}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Phone className="h-3.5 w-3.5" />
              {v.motorista.telefone}
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-transparent bg-blue-100 text-blue-700">
            <Truck className="mr-1 h-3 w-3" />
            {v.veiculo?.placa ?? "sem placa"}
          </Badge>
          <Badge className="border-transparent bg-emerald-100 text-emerald-700">
            <Clock className="mr-1 h-3 w-3" />
            {tempoRelativo(v.iniciadoEm, agora)}
          </Badge>
          <ExcluirButton
            perm="viagens.editar"
            path={PATH}
            id={v.id}
            nomeRecurso="esta viagem em andamento"
            invalidateKeys={[PATH]}
            size="sm"
            variant="outline"
            label="Cancelar"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {v.localCarga ? (
            <>
              {v.localCarga.nome}
              {v.localCarga.cidade && (
                <span className="text-xs">
                  · {v.localCarga.cidade}
                  {v.localCarga.uf ? `/${v.localCarga.uf}` : ""}
                </span>
              )}
            </>
          ) : (
            <span>Local de carga não identificado</span>
          )}
        </span>
        {v.lat != null && v.lng != null && (
          <a
            href={`https://www.google.com/maps?q=${v.lat},${v.lng}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            ver no mapa <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="border-t pt-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Eventos ({eventos.length})
        </p>
        {eventos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum evento registrado ainda.</p>
        ) : (
          <ol className="space-y-2">
            {eventos.map((ev) => {
              const ton = fmtTon(ev.toneladas);
              return (
                <li key={ev.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{ev.tipoSlug}</span>
                      <span className="text-xs text-muted-foreground">{fmtHora(ev.ocorridoEm)}</span>
                      {ton && <span className="text-xs text-muted-foreground">· {ton}</span>}
                    </div>
                    {ev.observacao && (
                      <p className="text-xs text-muted-foreground">{ev.observacao}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

export default function ViagensAndamentoPage() {
  const token = useAuthToken();
  const list = useQuery({
    queryKey: [PATH, "list"],
    enabled: !!token,
    queryFn: () => fetchApi<ViagemAndamento[]>(PATH, { token }),
    refetchInterval: POLL_MS,
  });

  // "há X" precisa recontar mesmo sem novo fetch; tick de 30s.
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const viagens = list.data ?? [];

  return (
    <RequerTela chave="viagens.ver">
      <div className="space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Viagens em andamento</h1>
            <p className="text-sm text-muted-foreground">
              Viagens abertas ao vivo. Atualiza sozinho a cada 20 segundos.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${list.isFetching ? "animate-spin" : ""}`} />
            {list.dataUpdatedAt ? `Atualizado às ${fmtDataHoraSP(new Date(list.dataUpdatedAt))}` : "Carregando…"}
          </div>
        </header>

        {list.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}

        {!list.isLoading && viagens.length === 0 && (
          <Card className="flex flex-col items-center gap-2 p-10 text-center">
            <Truck className="h-8 w-8 text-muted-foreground/60" />
            <p className="font-medium">Nenhuma viagem em andamento agora</p>
            <p className="text-sm text-muted-foreground">
              Quando um motorista iniciar uma viagem, ela aparece aqui ao vivo.
            </p>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {viagens.map((v) => (
            <ViagemCard key={v.id} v={v} agora={agora} />
          ))}
        </div>
      </div>
    </RequerTela>
  );
}
