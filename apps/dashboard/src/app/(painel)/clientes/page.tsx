"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
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
import { useDataTableState } from "@/hooks/use-data-table-state";
import {
  usePaginatedList,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";

type Empresa = { id: string; nome: string };
type Cliente = {
  id: string; nome: string; ativa: boolean;
  empresa: Empresa; empresaId: string;
};
const PATH = "/admin/clientes";
const EMPRESAS_PATH = "/admin/empresas";

export default function ClientesPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Cliente>(PATH, tableState);
  const empresas = useResourceOptions<Empresa>(EMPRESAS_PATH);
  const update = useUpdateResource<Partial<Cliente>, Cliente>(PATH, PATH);

  const empresaOptions = useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const columns = useMemo<ColumnDef<Cliente>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "empresa",
        accessorKey: "empresa.nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Empresa" />,
        cell: ({ row }) => row.original.empresa.nome,
      },
      {
        id: "ativa",
        accessorKey: "ativa",
        size: 96,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusToggle
            active={row.original.ativa}
            onChange={(next) => update.mutate({ id: row.original.id, body: { ativa: next } })}
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
            <Link href={`/clientes/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <ExcluirButton
              path="/admin/clientes"
              id={row.original.id}
              nomeRecurso={`o cliente "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">Clientes por empresa.</p>
        </div>
        <Link href="/clientes/novo">
          <Button disabled={!empresas.data?.length} className="w-full md:w-auto">
            <Plus className="h-4 w-4" /> Novo cliente
          </Button>
        </Link>
      </header>

      {empresas.data?.length === 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Cadastre uma empresa antes de criar clientes.
        </p>
      )}

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
            searchPlaceholder="Buscar por nome ou empresa…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.empresaId}
                  onChange={(v) => tableState.setFilter("empresaId", v)}
                  placeholder="Empresa"
                  options={empresaOptions}
                />
                <Combobox
                  value={tableState.filters.ativa}
                  onChange={(v) => tableState.setFilter("ativa", v)}
                  placeholder="Status"
                  showSearch={false}
                  options={[
                    { value: "true", label: "Ativos" },
                    { value: "false", label: "Inativos" },
                  ]}
                />
              </>
            }
          />
        }
        emptyMessage="Nenhum cliente cadastrado."
        renderMobileCard={(c) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{c.empresa.nome}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={c.ativa}
                  onChange={(next) => update.mutate({ id: c.id, body: { ativa: next } })}
                  size="sm"
                  label
                />
                <Link href={`/clientes/${c.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <ExcluirButton
                  path="/admin/clientes"
                  id={c.id}
                  nomeRecurso={`o cliente "${c.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
