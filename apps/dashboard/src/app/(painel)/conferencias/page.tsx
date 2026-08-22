"use client";

import Link from "next/link";
import { ScanEye, Clock, Loader2, AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";

type Divergencia = {
  campo: string;
  declarado: string;
  lido: string;
  gravidade: "ALTA" | "MEDIA";
  detalhe: string;
};
type Incerteza = { campo: string; declarado: string; lido: string; motivo: string };

type Conferencia = {
  id: string;
  viagemId: string;
  status: string;
  veredito: "BATE" | "DIVERGE" | "INCERTO" | "NAO_APLICAVEL" | null;
  confianca: number | null;
  divergencias: Divergencia[] | null;
  incertezas: Incerteza[] | null;
  acao: string | null;
  custoUsd: string | null;
  duracaoMs: number | null;
  passadas: number;
  modelo: string | null;
  erro: string | null;
  criadoEm: string;
  viagem: {
    data: string | null;
    ticket: string | null;
    status: string;
    motorista: { nome: string } | null;
  } | null;
};

type Resumo = {
  aguardando: number;
  executando: number;
  ultimas24h: number;
  custoUsd24h: number;
  porVeredito: Record<string, number>;
  modoSombra: boolean;
  ativa: boolean;
};

const VEREDITO = {
  BATE: { rotulo: "Confere", cor: "border-emerald-200 bg-emerald-50 text-emerald-800", icone: CheckCircle2 },
  DIVERGE: { rotulo: "Diverge", cor: "border-red-200 bg-red-50 text-red-800", icone: AlertTriangle },
  INCERTO: { rotulo: "Revisar", cor: "border-amber-200 bg-amber-50 text-amber-900", icone: Eye },
  NAO_APLICAVEL: { rotulo: "Sem o que conferir", cor: "border-slate-200 bg-slate-50 text-slate-600", icone: Eye },
} as const;

/**
 * O que a conferência automática leu de cada ticket. Leitura pura: decidir
 * sobre a viagem continua sendo na tela de Viagens.
 */
export default function ConferenciasPage() {
  const { temPermissao } = usePermissoes();
  const token = useAuthToken();
  const [enviando, setEnviando] = useState(false);
  const [recomparando, setRecomparando] = useState(false);
  const resumo = useApiQuery<Resumo>("/admin/conferencias/resumo", {
    staleTime: 0,
    refetchInterval: 15_000,
  });
  const lista = useApiQuery<Conferencia[]>("/admin/conferencias?limite=50", {
    refetchInterval: 15_000,
  });
  // Viagens que já existiam quando a conferência entrou no ar. Sem isso o
  // conferente só valeria daqui pra frente, e o acervo pendente — que é o
  // trabalho acumulado — ficaria de fora.
  const pendentes = useApiQuery<{ pendentes: number }>("/admin/conferencias/pendentes", {
    refetchInterval: 30_000,
  });

  async function recomparar() {
    setRecomparando(true);
    try {
      const r = await fetchApi<{ total: number; mudaram: number; porVeredito: Record<string, number> }>(
        "/admin/conferencias/recomparar",
        { method: "POST", token, body: "{}" },
      );
      toast.success(`${r.mudaram} de ${r.total} mudaram de veredito`, {
        description: "Sem custo: só a comparação rodou de novo, a leitura já estava guardada.",
      });
      void resumo.refetch();
      void lista.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui recomparar.");
    } finally {
      setRecomparando(false);
    }
  }

  async function conferirPendentes() {
    setEnviando(true);
    try {
      const r = await fetchApi<{ enfileiradas: number; candidatas: number }>(
        "/admin/conferencias/reprocessar",
        { method: "POST", token, body: JSON.stringify({ limite: 100 }) },
      );
      toast.success(`${r.enfileiradas} viagem(ns) na fila`, {
        description: "A conferência vai passando por elas nos próximos minutos.",
      });
      void resumo.refetch();
      void lista.refetch();
      void pendentes.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui enfileirar.");
    } finally {
      setEnviando(false);
    }
  }

  if (!temPermissao("viagens.ver")) {
    return <div className="p-6 text-sm text-muted-foreground">Você não tem acesso a esta tela.</div>;
  }

  const r = resumo.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ScanEye className="h-6 w-6" />
          Conferência de ticket
        </h1>
        <p className="text-sm text-muted-foreground">
          O que a leitura automática viu na foto, comparado com o que o motorista lançou.
        </p>
      </header>

      {r && !r.ativa && (
        <Card className="border-slate-300 bg-slate-50 p-4 text-sm">
          A conferência está <strong>desligada</strong> neste servidor.
        </Card>
      )}

      {r?.ativa && r.modoSombra && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Modo observação.</strong> A conferência está lendo e registrando o que acha, mas{" "}
          <strong>não mexe nas viagens e não avisa ninguém</strong>. É de propósito: dá pra comparar o
          que ela decidiria com o que a conferência humana decidiu, antes de deixar ela agir.
        </Card>
      )}

      {(pendentes.data?.pendentes ?? 0) > 0 && temPermissao("viagens.validar") && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">
              {pendentes.data?.pendentes} viagem(ns) com foto ainda sem conferência
            </p>
            <p className="text-sm text-muted-foreground">
              São as que já estavam aqui antes. Cada uma custa uma leitura (~R$ 0,03), então elas não
              entram sozinhas — vão até 100 por vez, das mais recentes pras mais antigas.
            </p>
          </div>
          <Button onClick={() => void conferirPendentes()} disabled={enviando}>
            {enviando ? "Enfileirando…" : "Conferir as pendentes"}
          </Button>
        </Card>
      )}

      {(r?.ultimas24h ?? 0) > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Reavaliar o que já foi lido</p>
            <p className="text-sm text-muted-foreground">
              Roda a comparação de novo, com as regras de hoje, em cima das leituras já guardadas.{" "}
              <strong>Não gasta nada</strong> — a leitura é a parte cara e ela já foi feita. Serve
              quando a regra fica mais esperta e o histórico precisa acompanhar.
            </p>
          </div>
          <Button variant="outline" onClick={() => void recomparar()} disabled={recomparando}>
            {recomparando ? "Recomparando…" : "Reavaliar sem custo"}
          </Button>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica titulo="Na fila" valor={r?.aguardando ?? 0} icone={<Clock className="h-4 w-4" />} />
        <Metrica
          titulo="Conferindo"
          valor={r?.executando ?? 0}
          icone={(r?.executando ?? 0) > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
        />
        <Metrica titulo="Últimas 24h" valor={r?.ultimas24h ?? 0} />
        <Metrica
          titulo="Custo 24h"
          valor={`R$ ${((r?.custoUsd24h ?? 0) * 5.45).toFixed(2)}`}
          rodape={
            r?.ultimas24h
              ? `≈ R$ ${(((r.custoUsd24h ?? 0) * 5.45) / r.ultimas24h).toFixed(3)} por ticket`
              : undefined
          }
        />
      </div>

      {r && Object.keys(r.porVeredito).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(r.porVeredito).map(([v, n]) => {
            const meta = VEREDITO[v as keyof typeof VEREDITO];
            return (
              <span key={v} className={`rounded border px-2 py-1 text-xs ${meta?.cor ?? ""}`}>
                {meta?.rotulo ?? v}: <strong>{n}</strong>
              </span>
            );
          })}
        </div>
      )}

      {lista.isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
      ) : (lista.data ?? []).length === 0 ? (
        <Card className="p-8 text-center">
          <ScanEye className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Nenhuma conferência ainda</p>
          <p className="text-sm text-muted-foreground">
            Elas aparecem sozinhas quando um motorista lança viagem com foto do ticket.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {(lista.data ?? []).map((c) => (
            <LinhaConferencia key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function Metrica({
  titulo,
  valor,
  icone,
  rodape,
}: {
  titulo: string;
  valor: string | number;
  icone?: React.ReactNode;
  rodape?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{titulo}</span>
        {icone}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      {rodape && <p className="mt-1 text-[11px] text-muted-foreground">{rodape}</p>}
    </Card>
  );
}

function LinhaConferencia({ c }: { c: Conferencia }) {
  const meta = c.veredito ? VEREDITO[c.veredito] : undefined;
  const Icone = meta?.icone ?? Clock;
  const divs = c.divergencias ?? [];
  const incs = c.incertezas ?? [];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${meta?.cor ?? ""}`}>
              <Icone className="h-3 w-3" />
              {meta?.rotulo ?? c.status}
            </span>
            <Link href={`/viagens/${c.viagemId}` as never} className="font-medium hover:underline">
              {c.viagem?.ticket ? `Ticket ${c.viagem.ticket}` : "Viagem sem ticket"}
            </Link>
            {c.viagem?.motorista && (
              <span className="text-sm text-muted-foreground">· {c.viagem.motorista.nome}</span>
            )}
            {c.confianca != null && (
              <Badge className="border-slate-200 bg-slate-100 text-slate-600">
                leitura {Math.round(c.confianca * 100)}%
              </Badge>
            )}
            {c.passadas > 1 && (
              <Badge className="border-purple-200 bg-purple-50 text-purple-700">2ª opinião</Badge>
            )}
          </div>

          {divs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {divs.map((d, i) => (
                <li key={i} className="text-sm">
                  <span
                    className={
                      d.gravidade === "ALTA" ? "font-medium text-red-700" : "text-amber-800"
                    }
                  >
                    {d.detalhe}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {incs.length > 0 && (
            <ul className="mt-2 space-y-1">
              {incs.map((i, k) => (
                <li key={k} className="text-sm text-muted-foreground">
                  <strong className="font-medium">{i.campo}:</strong> {i.motivo} — no ticket “{i.lido}”,
                  lançado “{i.declarado}”.
                </li>
              ))}
            </ul>
          )}

          {c.erro && <p className="mt-2 text-sm text-red-700">{c.erro}</p>}

          <p className="mt-2 text-xs text-muted-foreground">
            {fmtDataHoraBR(c.criadoEm)}
            {c.duracaoMs != null && ` · ${(c.duracaoMs / 1000).toFixed(1)}s`}
            {c.custoUsd != null && ` · R$ ${(Number(c.custoUsd) * 5.45).toFixed(4)}`}
            {c.acao && c.acao !== "NENHUMA" && ` · ${rotuloAcao(c.acao)}`}
          </p>
        </div>
      </div>
    </Card>
  );
}

function rotuloAcao(acao: string): string {
  if (acao === "AVISOU_MOTORISTA") return "motorista avisado";
  if (acao === "FILA_REVISAO") return "mandada pra revisão";
  return acao;
}
