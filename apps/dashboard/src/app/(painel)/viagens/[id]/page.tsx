"use client";

import Link from "next/link";
import { use, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Clock,
  Edit3,
  History,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import {
  fmtBR,
  fmtBRL,
  fmtDataHoraBR,
  fmtNum,
} from "@/lib/fechamento-helpers";
import { useHistoricoViagem } from "@/lib/fechamentos-api";
import { useQuery } from "@tanstack/react-query";

type ViagemDetalhe = {
  id: string;
  data: string;
  toneladas: string;
  ticket: string;
  km: string;
  status: string;
  observacao: string | null;
  valorPedagioTotal: string | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  motorista: { id: string; nome: string; usuario: string };
  obra: { id: string; nome: string; empresaCliente: { nome: string } };
  material: { id: string; nome: string };
  localCarga: { nome: string; cidade: string; uf: string; logradouro: string };
  localDescarga: { nome: string; cidade: string; uf: string; logradouro: string };
  fotos: { id: string; storageKey: string }[];
  matchesFechamento: Array<{
    id: string;
    fechamento: {
      id: string;
      versao: number;
      periodoInicio: string;
      periodoFim: string;
      empresaCliente: { nome: string };
    };
  }>;
};

type Tab = "dados" | "historico";

export default function ViagemDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const token = useAuthToken();
  const viagem = useQuery({
    queryKey: ["viagem-admin", id],
    enabled: !!token,
    queryFn: () => fetchApi<ViagemDetalhe>(`/admin/viagens/${id}`, { token }),
  });
  const historico = useHistoricoViagem(id);
  const [tab, setTab] = useState<Tab>("dados");

  if (viagem.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!viagem.data) return <p className="text-sm text-red-600">Viagem não encontrada.</p>;
  const v = viagem.data;

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <Link href="/viagens">
          <span className="rounded p-2 hover:bg-muted">
            <ArrowLeft className="h-5 w-5" />
          </span>
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Viagem {v.ticket}
            </h1>
            <Badge>{v.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {v.motorista.nome} · placa <span className="font-mono">{v.veiculo.placa}</span> ·{" "}
            {fmtBR(v.data)}
          </p>
        </div>
      </header>

      <div className="flex gap-1 border-b">
        {(
          [
            ["dados", "Dados"],
            ["historico", "Histórico de alterações"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
              tab === key
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "dados" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="p-5">
            <h3 className="mb-3 text-base font-medium">Dados do lançamento</h3>
            <dl className="space-y-2 text-sm">
              <Row label="Material" value={v.material.nome} />
              <Row label="Obra" value={v.obra.nome} />
              <Row label="Empresa-cliente" value={v.obra.empresaCliente.nome} />
              <Row label="Toneladas" value={fmtNum(v.toneladas, 3)} />
              <Row label="Km rodados" value={fmtNum(v.km, 2)} />
              <Row label="Ticket" value={v.ticket} mono />
              {v.valorPedagioTotal && <Row label="Pedágio" value={fmtBRL(v.valorPedagioTotal)} />}
              {v.observacao && <Row label="Observação" value={v.observacao} />}
            </dl>
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-base font-medium">Trajeto</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ArrowUp className="h-3.5 w-3.5" /> Carga
                </div>
                <p className="mt-0.5 font-medium">{v.localCarga.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {v.localCarga.logradouro} — {v.localCarga.cidade}/{v.localCarga.uf}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ArrowDown className="h-3.5 w-3.5" /> Descarga
                </div>
                <p className="mt-0.5 font-medium">{v.localDescarga.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {v.localDescarga.logradouro} — {v.localDescarga.cidade}/{v.localDescarga.uf}
                </p>
              </div>
            </div>
          </Card>

          {v.matchesFechamento.length > 0 && (
            <Card className="p-5 md:col-span-2">
              <h3 className="mb-3 text-base font-medium">Aparece em fechamentos</h3>
              <ul className="space-y-2 text-sm">
                {v.matchesFechamento.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <Link
                      href={`/fechamentos/${m.fechamento.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {m.fechamento.empresaCliente.nome} — {fmtBR(m.fechamento.periodoInicio)} a{" "}
                      {fmtBR(m.fechamento.periodoFim)} (v{m.fechamento.versao})
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === "historico" && (
        <Card className="p-5">
          <h3 className="mb-4 text-base font-medium">
            <History className="mr-2 inline h-4 w-4" />
            Linha do tempo
          </h3>
          {historico.isLoading && <p className="text-sm">Carregando...</p>}
          {historico.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem eventos ainda.</p>
          )}
          <ol className="relative space-y-4 border-l border-border pl-6">
            {historico.data?.map((ev) => {
              const Icon = iconForAcao(ev.acao);
              return (
                <li key={ev.id} className="relative">
                  <span
                    className={`absolute -left-[27px] top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-background ${colorForAcao(ev.acao)}`}
                  >
                    <Icon className="h-3 w-3 text-white" />
                  </span>
                  <div className="rounded-md border bg-background p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{labelForAcao(ev.acao)}</span>
                      {ev.campo && (
                        <Badge className="border-slate-200 bg-slate-50 text-slate-700">
                          {ev.campo}
                        </Badge>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {fmtDataHoraBR(ev.criadoEm)}
                      </span>
                    </div>
                    {ev.usuario && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <UserIcon className="mr-1 inline h-3 w-3" />
                        {ev.usuario.nome}
                      </p>
                    )}
                    {ev.motivo && <p className="mt-2 text-sm">{ev.motivo}</p>}
                    {(ev.valorAntes !== null || ev.valorDepois !== null) && (
                      <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                        {ev.valorAntes !== null && ev.valorAntes !== undefined && (
                          <div className="rounded bg-red-50 p-2 text-red-900">
                            <p className="font-medium">Antes</p>
                            <pre className="whitespace-pre-wrap break-words font-mono">
                              {formatVal(ev.valorAntes)}
                            </pre>
                          </div>
                        )}
                        {ev.valorDepois !== null && ev.valorDepois !== undefined && (
                          <div className="rounded bg-green-50 p-2 text-green-900">
                            <p className="font-medium">Depois</p>
                            <pre className="whitespace-pre-wrap break-words font-mono">
                              {formatVal(ev.valorDepois)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono" : ""}>{value}</dd>
    </div>
  );
}

function labelForAcao(acao: string): string {
  return (
    {
      UPDATE: "Atualização",
      DELETE: "Remoção",
      RESOLVER: "Resolução manual",
      SUBSTITUIR: "Substituição",
      EXPORTAR: "Exportação",
      MARCAR_ENVIADO: "Marcado como enviado",
      MATCH_AUTOMATICO: "Match automático",
      MATCH_IA: "Match via IA",
    } as const
  )[acao as never] ?? acao;
}

function iconForAcao(acao: string) {
  if (acao === "MATCH_IA") return Sparkles;
  if (acao === "MATCH_AUTOMATICO" || acao === "RESOLVER") return CheckCircle2;
  if (acao === "UPDATE") return Edit3;
  return Clock;
}

function colorForAcao(acao: string): string {
  if (acao === "MATCH_IA") return "bg-emerald-500";
  if (acao === "MATCH_AUTOMATICO") return "bg-green-500";
  if (acao === "RESOLVER") return "bg-blue-500";
  if (acao === "UPDATE") return "bg-orange-500";
  if (acao === "EXPORTAR" || acao === "MARCAR_ENVIADO") return "bg-purple-500";
  return "bg-gray-500";
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}
