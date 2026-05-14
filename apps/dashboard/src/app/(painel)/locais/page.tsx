"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertCircle, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterSelect,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import {
  usePaginatedList,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";
type Obra = { id: string; nome: string };
type Local = {
  id: string; nome: string; logradouro: string; numero: string | null; bairro: string | null;
  cidade: string; uf: string; cep: string | null; pontoReferencia: string | null;
  tipo: Tipo; obraId: string | null; ativo: boolean; obra: Obra | null;
};

const PATH = "/admin/locais";
const OBRAS_PATH = "/admin/obras";

export default function LocaisPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Local>(PATH, tableState);
  const obras = useResourceOptions<Obra>(OBRAS_PATH);
  const update = useUpdateResource<Record<string, unknown>, Local>(PATH, PATH);

  const obraOptions = useMemo(
    () => (obras.data ?? []).map((o) => ({ value: o.id, label: o.nome })),
    [obras.data],
  );

  const columns = useMemo<ColumnDef<Local>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "endereco",
        enableSorting: false,
        header: "Endereço",
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.logradouro}
            {row.original.numero ? `, ${row.original.numero}` : ""}
            {row.original.bairro ? ` — ${row.original.bairro}` : ""}
          </span>
        ),
      },
      {
        id: "cidade",
        accessorKey: "cidade",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cidade/UF" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.cidade}/{row.original.uf}
          </span>
        ),
      },
      {
        id: "obra",
        enableSorting: false,
        header: "Obra",
        cell: ({ row }) => row.original.obra?.nome ?? "—",
      },
      {
        id: "tipo",
        accessorKey: "tipo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      },
      {
        id: "acoes",
        size: 180,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-2">
            <StatusToggle
              active={row.original.ativo}
              onChange={(next) =>
                update.mutate({ id: row.original.id, body: { ativo: next } })
              }
              size="sm"
            />
            <Link href={`/locais/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <ExcluirButton
              path="/admin/locais"
              id={row.original.id}
              nomeRecurso={`o local "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Locais</h1>
          <p className="text-sm text-muted-foreground">
            Locais de carga e descarga. Busque por nome, endereço ou ponto de interesse.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/locais/em-validacao">
            <Button variant="outline" className="w-full md:w-auto">
              <AlertCircle className="h-4 w-4" /> Em validação
            </Button>
          </Link>
          <Link href="/locais/novo">
            <Button className="w-full md:w-auto">
              <Plus className="h-4 w-4" /> Novo local
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
            searchPlaceholder="Buscar por nome, endereço, bairro, cidade…"
            filters={
              <>
                <ToolbarFilterSelect
                  label="Tipo"
                  value={tableState.filters.tipo}
                  onChange={(v) => tableState.setFilter("tipo", v)}
                  options={[
                    { value: "AMBOS", label: "Ambos" },
                    { value: "CARGA", label: "Carga" },
                    { value: "DESCARGA", label: "Descarga" },
                  ]}
                />
                <ToolbarFilterSelect
                  label="Obra"
                  value={tableState.filters.obraId}
                  onChange={(v) => tableState.setFilter("obraId", v)}
                  options={obraOptions}
                />
                <ToolbarFilterSelect
                  label="Status"
                  value={tableState.filters.ativo}
                  onChange={(v) => tableState.setFilter("ativo", v)}
                  options={[
                    { value: "true", label: "Ativos" },
                    { value: "false", label: "Inativos" },
                  ]}
                />
              </>
            }
          />
        }
        emptyMessage="Nenhum local cadastrado."
        renderMobileCard={(l) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.cidade}/{l.uf}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={l.ativo}
                  onChange={(next) => update.mutate({ id: l.id, body: { ativo: next } })}
                  size="sm"
                  label
                />
                <Link href={`/locais/${l.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <ExcluirButton
                  path="/admin/locais"
                  id={l.id}
                  nomeRecurso={`o local "${l.nome}"`}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {l.logradouro}
              {l.numero ? `, ${l.numero}` : ""}
              {l.bairro ? ` — ${l.bairro}` : ""}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>
                <span className="text-muted-foreground">Tipo: </span>
                {l.tipo}
              </span>
              {l.obra && (
                <span>
                  <span className="text-muted-foreground">Obra: </span>
                  {l.obra.nome}
                </span>
              )}
            </div>
          </Card>
        )}
      />
    </div>
  );
}
