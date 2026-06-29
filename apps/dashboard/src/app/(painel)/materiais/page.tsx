"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Package, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Material = {
  id: string;
  nome: string;
  ativo: boolean;
  criadoPor: { id: string; nome: string } | null;
};

const PATH = "/admin/materiais";

export default function MateriaisPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Material>(PATH, tableState);
  const update = useUpdateResource<{ ativo?: boolean }, Material>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("materiais");

  const columns = useMemo<ColumnDef<Material>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "criadoPor",
        enableSorting: false,
        header: "Criado por",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.criadoPor?.nome ?? "—"}
          </span>
        ),
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 128,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusToggle
            active={row.original.ativo}
            onChange={(next) => update.mutate({ id: row.original.id, body: { ativo: next } })}
            size="sm"
            label
          />
        ),
      },
      {
        id: "acoes",
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Link href={`/materiais/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <ExcluirButton perm="materiais.excluir"
              path="/admin/materiais"
              id={row.original.id}
              nomeRecurso={`o material "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Materiais</h1>
          <p className="text-sm text-muted-foreground">Tipos de material transportado.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Link href="/materiais/novo">
            <Button>
              <Plus className="h-4 w-4" /> Novo material
            </Button>
          </Link>
        </div>
      </header>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        pagination={list.data?.pagination}
        state={tableState}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        toolbar={
          <DataTableToolbar
            state={tableState}
            searchPlaceholder="Buscar material…"
            filters={
              <Combobox
                value={tableState.filters.ativo}
                onChange={(v) => tableState.setFilter("ativo", v)}
                placeholder="Status"
                showSearch={false}
                options={[
                  { value: "true", label: "Ativos" },
                  { value: "false", label: "Inativos" },
                ]}
              />
            }
          />
        }
        emptyMessage="Nenhum material cadastrado."
        viewMode={viewMode}
        renderMobileCard={(m) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{m.nome}</span>
                </div>
                {m.criadoPor && (
                  <div className="text-xs text-muted-foreground">
                    Criado por {m.criadoPor.nome}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <StatusToggle
                  active={m.ativo}
                  onChange={(next) =>
                    update.mutate({ id: m.id, body: { ativo: next } })
                  }
                  size="sm"
                />
                <Link href={`/materiais/${m.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <ExcluirButton perm="materiais.excluir"
                  path="/admin/materiais"
                  id={m.id}
                  nomeRecurso={`o material "${m.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
