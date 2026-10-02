"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Route } from "next";
import { FileSignature, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { STATUS_ORCAMENTO, STATUS_ORCAMENTO_LABEL } from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, DataTableToolbar } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList } from "@/lib/client-api";
import { STATUS_COR, brl, dataBR, type Orcamento } from "./_components/tipos";

const PATH = "/admin/orcamentos";

export default function OrcamentosPage() {
  return (
    <RequerTela chave="orcamentos.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Status({ o }: { o: Orcamento }) {
  return <Badge className={`border-transparent ${STATUS_COR[o.status]}`}>{STATUS_ORCAMENTO_LABEL[o.status]}</Badge>;
}

function Total({ o }: { o: Orcamento }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {brl(o.total)}
      {o.itensSemValor > 0 && <span className="text-xs text-amber-700"> +{o.itensSemValor} a calcular</span>}
    </span>
  );
}

function Conteudo() {
  const tableState = useDataTableState({ defaultSort: { field: "numero", order: "desc" } });
  const list = usePaginatedList<Orcamento>(PATH, tableState);
  const { viewMode, setViewMode } = useListViewMode("orcamentos");

  const columns = useMemo<ColumnDef<Orcamento>[]>(
    () => [
      {
        id: "numero",
        size: 64,
        enableSorting: true,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nº" />,
        cell: ({ row }) => <span className="font-mono text-sm text-muted-foreground">#{row.original.numero}</span>,
      },
      {
        id: "cliente",
        enableSorting: false,
        header: "Para quem",
        cell: ({ row }) => (
          <Link href={`/orcamentos/${row.original.id}` as Route} className="block min-w-0 hover:underline">
            <p className="truncate font-medium">{row.original.destinatario}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.original.empresaId ? row.original.cliente?.nome ?? "cliente cadastrado" : "ainda não é cliente"}
              {" · "}
              {row.original.itens.map((i) => i.material?.nome ?? i.descricao ?? "transporte").join(", ")}
            </p>
          </Link>
        ),
      },
      {
        id: "total",
        enableSorting: false,
        header: "Total estimado",
        cell: ({ row }) => <Total o={row.original} />,
      },
      {
        id: "validadeEm",
        enableSorting: true,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vale até" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-sm tabular-nums">{dataBR(row.original.validadeEm)}</span>,
      },
      {
        id: "status",
        enableSorting: false,
        header: "Situação",
        cell: ({ row }) => <Status o={row.original} />,
      },
      {
        id: "acoes",
        size: 90,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Link href={`/orcamentos/${row.original.id}` as Route}>
              <Button variant="outline" size="sm">
                Abrir
              </Button>
            </Link>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orçamentos</h1>
          <p className="text-sm text-muted-foreground">
            As propostas que você mandou. Aprovada, a proposta vira pedido sem digitar de novo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="orcamentos.criar">
            <Link href={"/orcamentos/novo" as Route}>
              <Button>
                <Plus className="h-4 w-4" /> Novo orçamento
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
            searchPlaceholder="Buscar por cliente ou obra…"
            filters={
              <Combobox
                value={tableState.filters.status}
                onChange={(v) => tableState.setFilter("status", v)}
                placeholder="Todas as situações"
                options={STATUS_ORCAMENTO.map((s) => ({ value: s, label: STATUS_ORCAMENTO_LABEL[s] }))}
              />
            }
          />
        }
        emptyMessage="Nenhum orçamento. Monte a primeira proposta pra mandar ao cliente."
        viewMode={viewMode}
        renderMobileCard={(o) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-medium">
                  <FileSignature className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {o.destinatario}
                </p>
                <p className="text-xs text-muted-foreground">
                  #{o.numero} · vale até {dataBR(o.validadeEm)}
                </p>
              </div>
              <Status o={o} />
            </div>
            <div className="flex items-center justify-between">
              <Total o={o} />
              <Link href={`/orcamentos/${o.id}` as Route}>
                <Button variant="outline" size="sm">
                  Abrir
                </Button>
              </Link>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
