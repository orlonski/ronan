"use client";

import * as React from "react";
import { useMemo } from "react";
import Link from "next/link";
import { Pencil, Plus, RefreshCw, Tag } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BASE_PRECO_LABEL, type BasePrecoTipo } from "@ronan/shared-types";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableToolbar } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import {
  fetchApi,
  useAuthToken,
  usePaginatedList,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";
import { useConfirm } from "@/components/confirm-dialog";

type Empresa = { id: string; nome: string };
type Preco = {
  id: string;
  empresa: Empresa;
  material: { id: string; nome: string } | null;
  tipoServico: { id: string; nome: string } | null;
  kmFaixaDe: string;
  kmFaixaAte: string | null;
  base: BasePrecoTipo;
  precoUnitario: string;
  repassaPedagio: boolean;
  vigenciaDe: string;
  vigenciaAte: string | null;
  ativo: boolean;
};

const PATH = "/admin/tabelas-preco";

function fmtNum(v: string | null): string {
  if (v == null) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR") : v;
}

function fmtMoeda(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : v;
}

function fmtData(v: string | null): string {
  if (!v) return "";
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** "a partir de 01/06" / "01/06 a 31/07" — o período em uma linha. */
function vigencia(p: Preco): string {
  return p.vigenciaAte
    ? `${fmtData(p.vigenciaDe)} a ${fmtData(p.vigenciaAte)}`
    : `desde ${fmtData(p.vigenciaDe)}`;
}

export default function TabelasPrecoPage() {
  const tableState = useDataTableState({ defaultSort: { field: "vigenciaDe", order: "desc" } });
  const list = usePaginatedList<Preco>(PATH, tableState);
  const empresas = useResourceOptions<Empresa>("/admin/empresas");
  const update = useUpdateResource<{ ativo?: boolean }, Preco>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("tabelas-preco");

  const empresaOptions = useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const columns = useMemo<ColumnDef<Preco>[]>(
    () => [
      {
        id: "empresa",
        enableSorting: false,
        header: "Cliente",
        cell: ({ row }) => <span className="font-medium">{row.original.empresa.nome}</span>,
      },
      {
        id: "material",
        enableSorting: false,
        header: "Material",
        cell: ({ row }) =>
          row.original.material ? (
            row.original.material.nome
          ) : (
            <span className="text-muted-foreground">Qualquer</span>
          ),
      },
      {
        id: "servico",
        enableSorting: false,
        header: "Modo",
        cell: ({ row }) =>
          row.original.tipoServico ? (
            row.original.tipoServico.nome
          ) : (
            <span className="text-muted-foreground">Qualquer</span>
          ),
      },
      {
        id: "precoUnitario",
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Preço" />
        ),
        cell: ({ row }) => (
          <span className="tabular-nums font-medium">
            {fmtMoeda(row.original.precoUnitario)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {BASE_PRECO_LABEL[row.original.base].unidade.replace("R$", "")}
            </span>
          </span>
        ),
      },
      {
        id: "faixa",
        enableSorting: false,
        header: "Faixa (km)",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {fmtNum(row.original.kmFaixaDe)} –{" "}
            {row.original.kmFaixaAte ? fmtNum(row.original.kmFaixaAte) : "∞"}
          </span>
        ),
      },
      {
        id: "vigenciaDe",
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Vigência" />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm tabular-nums">{vigencia(row.original)}</span>
        ),
      },
      {
        id: "pedagio",
        enableSorting: false,
        header: "Pedágio",
        cell: ({ row }) =>
          row.original.repassaPedagio ? (
            <span className="text-sm">Por fora</span>
          ) : (
            <span className="text-sm text-muted-foreground">No frete</span>
          ),
      },
      {
        id: "ativo",
        size: 128,
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => (
          <Permitido chave="tabelas-preco.editar">
            <StatusToggle
              active={row.original.ativo}
              onChange={(next) => update.mutate({ id: row.original.id, body: { ativo: next } })}
              size="sm"
              label
            />
          </Permitido>
        ),
      },
      {
        id: "acoes",
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Permitido chave="tabelas-preco.editar">
              <Link href={`/tabelas-preco/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            <ExcluirButton
              perm="tabelas-preco.excluir"
              path={PATH}
              id={row.original.id}
              nomeRecurso="este preço"
            />
          </div>
        ),
      },
    ],
    [update],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tabela de preços</h1>
          <p className="text-sm text-muted-foreground">
            Quanto cada cliente paga por tonelada, km ou viagem. O preço multiplica a
            quantidade já com o mínimo aplicado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <BotaoRecalcular
            empresaId={tableState.filters.empresaId}
            nomeEmpresa={empresaOptions.find((o) => o.value === tableState.filters.empresaId)?.label}
          />
          <Permitido chave="tabelas-preco.criar">
            <Link href="/tabelas-preco/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo preço
              </Button>
            </Link>
          </Permitido>
        </div>
      </header>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        pagination={list.data?.pagination}
        state={tableState}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        toolbar={
          <DataTableToolbar
            state={tableState}
            searchPlaceholder="Buscar por cliente ou material…"
            filters={
              <Combobox
                value={tableState.filters.empresaId}
                onChange={(v) => tableState.setFilter("empresaId", v)}
                placeholder="Cliente"
                options={empresaOptions}
              />
            }
          />
        }
        emptyMessage="Nenhum preço cadastrado. Sem preço, a viagem não tem valor e a planilha de fechamento sai sem a coluna de dinheiro."
        viewMode={viewMode}
        renderMobileCard={(p) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{p.empresa.nome}</span>
              <span className="text-sm text-muted-foreground">
                · {p.material ? p.material.nome : "Qualquer"}
              </span>
            </div>
            <div className="text-sm tabular-nums">
              <span className="font-medium">{fmtMoeda(p.precoUnitario)}</span>{" "}
              <span className="text-muted-foreground">
                {BASE_PRECO_LABEL[p.base].unidade.replace("R$", "")} · faixa {fmtNum(p.kmFaixaDe)}–
                {p.kmFaixaAte ? fmtNum(p.kmFaixaAte) : "∞"} km
              </span>
            </div>
            <div className="text-xs text-muted-foreground">{vigencia(p)}</div>
            <div className="flex items-center gap-1">
              <Permitido chave="tabelas-preco.editar">
                <StatusToggle
                  active={p.ativo}
                  onChange={(next) => update.mutate({ id: p.id, body: { ativo: next } })}
                  size="sm"
                />
                <Link href={`/tabelas-preco/${p.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
              </Permitido>
              <ExcluirButton
                perm="tabelas-preco.excluir"
                path={PATH}
                id={p.id}
                nomeRecurso="este preço"
              />
            </div>
          </Card>
        )}
      />
    </div>
  );
}

/**
 * Refazer o preço de todas as viagens de uma empresa.
 *
 * Existe porque cadastrar uma tabela só recalcula a janela de vigência dela: o
 * histórico anterior fica sem valor e dependia do cron das 04:40, que varre 500
 * por noite e só quem está SEM valor nenhum. Quem corrigiu o mínimo por faixa,
 * ou o km de um monte de viagem, precisava esperar sem saber que estava
 * esperando.
 *
 * Pede confirmação porque reescreve o valor de milhares de viagens — e ignora
 * de propósito quem teve o valor alterado à mão, que é o que a regra do
 * recálculo já garante.
 */
function BotaoRecalcular({ empresaId, nomeEmpresa }: { empresaId?: string; nomeEmpresa?: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { confirmar, ConfirmDialog } = useConfirm();
  const [rodando, setRodando] = React.useState(false);

  // Sem empresa escolhida não há o que recalcular: o endpoint é por empresa, e
  // "todas" seria uma varredura da base inteira disparada por engano.
  if (!empresaId) return null;

  async function recalcular() {
    const ok = await confirmar({
      variant: "warning",
      title: `Refazer o preço das viagens de ${nomeEmpresa ?? "este cliente"}?`,
      description:
        "Vale pras viagens fechadas que ainda não têm valor ou cujo valor veio da tabela. Valor alterado à mão não é tocado.",
      confirmLabel: "Refazer os preços",
      cancelLabel: "Agora não",
    });
    if (!ok || !token) return;
    setRodando(true);
    try {
      const r = await fetchApi<{ total: number; precificadas: number }>(
        `/admin/tabelas-preco/recalcular/${empresaId}`,
        { token, method: "POST" },
      );
      toast.success(
        r.precificadas === 0
          ? `Nenhuma das ${r.total} viagens casou com uma tabela.`
          : `${r.precificadas} de ${r.total} viagens ganharam valor.`,
      );
      await qc.invalidateQueries({ queryKey: ["viagens"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRodando(false);
    }
  }

  return (
    <Permitido chave="tabelas-preco.editar">
      <ConfirmDialog />
      <Button variant="outline" disabled={rodando} onClick={() => void recalcular()}>
        <RefreshCw className={`h-4 w-4 ${rodando ? "animate-spin" : ""}`} />
        {rodando ? "Refazendo…" : "Refazer preços"}
      </Button>
    </Permitido>
  );
}
