"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, FileCode2, GitBranch, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useApiQuery, useCreateResource } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";
import { STATUS_DEMANDA, StatusDemanda, duracao } from "../_components/status-demanda";
import type { Demanda } from "../page";

/** Extrai a URL do PR do relato, pra virar botão em vez de texto solto. */
function urlDoPr(relato: string | null): string | null {
  const m = relato?.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
  return m ? m[0] : null;
}

export default function DemandaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { temPermissao } = usePermissoes();
  const d = useApiQuery<Demanda>(`/admin/demandas/${id}`, {
    // Enquanto não terminou, a página acompanha sozinha.
    refetchInterval: 5_000,
  });
  const repetir = useCreateResource<undefined, { id: string }>(
    `/admin/demandas/${id}/repetir`,
    "/admin/demandas",
  );

  if (d.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!d.data) return <p className="text-sm text-muted-foreground">Demanda não encontrada.</p>;

  const demanda = d.data;
  const terminou = !["PENDENTE", "EXECUTANDO"].includes(demanda.status);
  const pr = urlDoPr(demanda.relato);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={"/demandas" as never}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Demandas
        </Link>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusDemanda status={demanda.status} />
              <h1 className="text-2xl font-semibold tracking-tight">{demanda.titulo}</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {fmtDataHoraBR(demanda.criadoEm)}
              {demanda.criadoPorNome && ` · pedida por ${demanda.criadoPorNome}`}
              {` · ${demanda.taskId}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pr && (
              <a href={pr} target="_blank" rel="noreferrer">
                <Button variant="outline">
                  <ExternalLink className="mr-2 h-4 w-4" /> Ver no GitHub
                </Button>
              </a>
            )}
            {terminou && temPermissao("demandas.criar") && (
              <Button
                variant="outline"
                disabled={repetir.isPending}
                onClick={async () => {
                  try {
                    await repetir.mutateAsync(undefined);
                    toast.success("Mandei de novo", {
                      description: "Uma demanda nova entrou na fila com o mesmo pedido.",
                    });
                  } catch (err) {
                    toast.error("Não deu", { description: (err as Error).message });
                  }
                }}
              >
                <RotateCw className="mr-2 h-4 w-4" /> Pedir de novo
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">O que foi pedido</h2>
        <p className="whitespace-pre-wrap text-sm">{demanda.descricao}</p>
      </Card>

      {!terminou ? (
        <Card className="flex items-center gap-3 p-5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
          </span>
          <div>
            <p className="text-sm font-medium">
              {demanda.status === "PENDENTE" ? "Esperando o agente pegar" : "O agente está nessa"}
            </p>
            <p className="text-sm text-muted-foreground">
              {STATUS_DEMANDA[demanda.status]?.dica} Esta página se atualiza sozinha.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">O que o agente relatou</h2>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Duração: {duracao(demanda.duracaoMs)}</span>
              {demanda.custoUsd != null && (
                <span title="Estimativa do CLI. Na assinatura não vira cobrança.">
                  ≈ US$ {demanda.custoUsd.toFixed(2)} em tokens
                </span>
              )}
              {demanda.tentativas > 0 && <span>{demanda.tentativas + 1} tentativas</span>}
            </div>
          </div>
          <p
            className={`whitespace-pre-wrap text-sm ${
              demanda.deuCerto ? "" : "text-rose-800 dark:text-rose-300"
            }`}
          >
            {demanda.relato ?? "Sem relato."}
          </p>
        </Card>
      )}

      {(demanda.branch || demanda.arquivosAlterados.length > 0) && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">O que mudou</h2>
          {demanda.branch && (
            <p className="mb-3 flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{demanda.branch}</code>
            </p>
          )}
          {demanda.arquivosAlterados.length > 0 ? (
            <ul className="space-y-1">
              {demanda.arquivosAlterados.map((a) => (
                <li key={a} className="flex items-center gap-2 text-sm">
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <code className="truncate text-xs">{a}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum arquivo alterado.</p>
          )}
        </Card>
      )}
    </div>
  );
}
