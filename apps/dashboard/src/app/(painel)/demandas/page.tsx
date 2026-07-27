"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, ChevronRight, Clock, FileCode2, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { DataTableToolbar } from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { usePaginatedList, useApiQuery } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";
import { NovaDemanda } from "./_components/nova-demanda";
import { StatusDemanda, desde, duracao } from "./_components/status-demanda";

export type Demanda = {
  id: string;
  taskId: string;
  titulo: string;
  descricao: string;
  origem: "painel" | "webhook";
  criadoPorNome: string | null;
  status: string;
  tentativas: number;
  duracaoMs: number | null;
  custoUsd: number | null;
  branch: string | null;
  arquivosAlterados: string[];
  relato: string | null;
  deuCerto: boolean;
  criadoEm: string;
};

type Resumo = {
  aguardando: number;
  executando: number;
  ultimas24h: number;
  duracaoMediaMs: number | null;
  custoEstimado24h: number;
  agenteVistoEm: string | null;
  agenteWorkerId: string | null;
};

/** Agente é considerado vivo se reivindicou algo há menos de 2 minutos. */
function agenteVivo(visto: string | null): boolean {
  return !!visto && Date.now() - new Date(visto).getTime() < 120_000;
}

export default function DemandasPage() {
  const { temPermissao } = usePermissoes();
  const [status, setStatus] = useState<string | undefined>();
  const tableState = useDataTableState({ defaultSort: { field: "criadoEm", order: "desc" } });

  // Resumo primeiro: é ele que sabe se tem algo vivo (inclusive fora da página
  // atual da lista) e, portanto, se vale ficar atualizando sozinho.
  const resumo = useApiQuery<Resumo>("/admin/demandas/resumo", {
    staleTime: 0,
    refetchInterval: 5_000,
  });
  const temVivas = (resumo.data?.aguardando ?? 0) + (resumo.data?.executando ?? 0) > 0;

  const lista = usePaginatedList<Demanda>(
    "/admin/demandas",
    { ...tableState, filters: { ...tableState.filters, ...(status ? { status } : {}) } },
    // Só fica recarregando enquanto há o que acompanhar — parado, a tela para.
    { refetchInterval: temVivas ? 5_000 : false },
  );

  const demandas = lista.data?.data ?? [];
  const vivo = agenteVivo(resumo.data?.agenteVistoEm ?? null);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Demandas do agente</h1>
          <p className="text-sm text-muted-foreground">
            Escreva o que precisa; o agente trabalha numa branch própria e devolve o resultado.
          </p>
        </div>
        <div
          className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
          title={
            resumo.data?.agenteWorkerId
              ? `Último contato: ${resumo.data.agenteWorkerId}`
              : "Nenhuma execução registrada ainda"
          }
        >
          <span
            className={`h-2 w-2 rounded-full ${vivo ? "bg-emerald-500" : "bg-slate-300"}`}
            aria-hidden
          />
          <span className={vivo ? "text-foreground" : "text-muted-foreground"}>
            {vivo
              ? "Agente ativo"
              : resumo.data?.agenteVistoEm
                ? `Agente visto há ${desde(resumo.data.agenteVistoEm)}`
                : "Agente nunca respondeu"}
          </span>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          titulo="Na fila"
          valor={resumo.data?.aguardando ?? 0}
          icone={<Clock className="h-4 w-4" />}
        />
        <Metrica
          titulo="Trabalhando"
          valor={resumo.data?.executando ?? 0}
          icone={
            (resumo.data?.executando ?? 0) > 0 ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Bot className="h-4 w-4" />
            )
          }
        />
        <Metrica titulo="Últimas 24h" valor={resumo.data?.ultimas24h ?? 0} />
        <Metrica
          titulo="Tempo médio"
          valor={duracao(resumo.data?.duracaoMediaMs ?? null)}
          rodape={
            resumo.data?.custoEstimado24h
              ? `≈ US$ ${resumo.data.custoEstimado24h.toFixed(2)} em tokens nas 24h (estimativa, não é cobrança)`
              : undefined
          }
        />
      </div>

      {temPermissao("demandas.criar") && (
        <NovaDemanda
          onCriada={() => {
            void lista.refetch();
            void resumo.refetch();
          }}
        />
      )}

      <div className="space-y-3">
        <DataTableToolbar
          state={tableState}
          searchPlaceholder="Buscar no que você pediu…"
          hideSearch
          filters={
            <>
              <Combobox
                value={status}
                onChange={setStatus}
                placeholder="Status"
                showSearch={false}
                options={[
                  { value: "PENDENTE", label: "Na fila" },
                  { value: "EXECUTANDO", label: "Trabalhando" },
                  { value: "CONCLUIDA", label: "Pronta" },
                  { value: "FALHOU", label: "Falhou" },
                  { value: "EXCEDEU_LIMITE", label: "Passou do limite" },
                ]}
              />
              <button
                type="button"
                onClick={() => {
                  void lista.refetch();
                  void resumo.refetch();
                }}
                className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent/30"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${lista.isFetching ? "animate-spin" : ""}`} />
                Atualizar
              </button>
            </>
          }
        />

        {lista.isLoading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Carregando…</Card>
        ) : demandas.length === 0 ? (
          <Card className="p-8 text-center">
            <Bot className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Nenhuma demanda ainda</p>
            <p className="text-sm text-muted-foreground">
              Escreva a primeira aí em cima — o agente pega em segundos.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {demandas.map((d) => (
              <LinhaDemanda key={d.id} d={d} />
            ))}
          </div>
        )}
      </div>
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
      {rodape && <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{rodape}</p>}
    </Card>
  );
}

function LinhaDemanda({ d }: { d: Demanda }) {
  const rodando = d.status === "EXECUTANDO";
  return (
    <Link href={`/demandas/${d.id}` as never}>
      <Card
        className={`flex items-center gap-4 p-4 transition-colors hover:bg-accent/30 ${
          rodando ? "border-blue-300 bg-blue-50/40 dark:bg-blue-950/10" : ""
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDemanda status={d.status} />
            <span className="truncate font-medium">{d.titulo}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{fmtDataHoraBR(d.criadoEm)}</span>
            {d.criadoPorNome && (
              <>
                <span>·</span>
                <span>{d.criadoPorNome}</span>
              </>
            )}
            {d.origem === "webhook" && (
              <>
                <span>·</span>
                <Badge className="border-slate-200 bg-slate-100 text-slate-600">webhook</Badge>
              </>
            )}
            {d.arquivosAlterados.length > 0 && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <FileCode2 className="h-3 w-3" />
                  {d.arquivosAlterados.length} arquivo
                  {d.arquivosAlterados.length > 1 ? "s" : ""}
                </span>
              </>
            )}
            {d.duracaoMs != null && (
              <>
                <span>·</span>
                <span className="tabular-nums">{duracao(d.duracaoMs)}</span>
              </>
            )}
            {rodando && (
              <>
                <span>·</span>
                <span className="tabular-nums text-blue-700">há {desde(d.criadoEm)} rodando</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Card>
    </Link>
  );
}

