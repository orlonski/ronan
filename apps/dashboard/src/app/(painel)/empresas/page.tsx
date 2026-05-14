"use client";

import { useMemo } from "react";
import { FileSpreadsheet, FileInput, Pencil, Plus } from "lucide-react";
import Link from "next/link";
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
import { usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Papel = "RECEBE_PLANILHA" | "MANDA_FECHAMENTO" | "AMBOS";
type Empresa = {
  id: string; nome: string; cnpj: string | null; contato: string | null;
  papel: Papel; ativa: boolean;
};
const PATH = "/admin/empresas";

const PAPEL_LABEL: Record<Papel, string> = {
  RECEBE_PLANILHA: "Recebe planilha",
  MANDA_FECHAMENTO: "Manda fechamento",
  AMBOS: "Ambos",
};

export default function EmpresasPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Empresa>(PATH, tableState);
  const update = useUpdateResource<Partial<Empresa>, Empresa>(PATH, PATH);

  const columns = useMemo<ColumnDef<Empresa>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "cnpj",
        accessorKey: "cnpj",
        header: ({ column }) => <DataTableColumnHeader column={column} title="CNPJ" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.cnpj ?? "—"}</span>
        ),
      },
      {
        id: "papel",
        accessorKey: "papel",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Papel" />,
        cell: ({ row }) => PAPEL_LABEL[row.original.papel],
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
        size: 180,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => {
          const e = row.original;
          return (
            <div className="flex justify-center">
              {(e.papel === "RECEBE_PLANILHA" || e.papel === "AMBOS") && (
                <Link href={`/empresas/${e.id}/layout-envio`} title="Layout de envio">
                  <Button variant="ghost" size="icon">
                    <FileSpreadsheet className="h-4 w-4" />
                  </Button>
                </Link>
              )}
              {(e.papel === "MANDA_FECHAMENTO" || e.papel === "AMBOS") && (
                <Link href={`/empresas/${e.id}/layout-import`} title="Layout de importação">
                  <Button variant="ghost" size="icon">
                    <FileInput className="h-4 w-4" />
                  </Button>
                </Link>
              )}
              <Link href={`/empresas/${e.id}`} title="Editar">
                <Button variant="ghost" size="icon">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
              <ExcluirButton
                path="/admin/empresas"
                id={e.id}
                nomeRecurso={`a empresa "${e.nome}"`}
              />
            </div>
          );
        },
      },
    ],
    [update],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas-cliente</h1>
          <p className="text-sm text-muted-foreground">Empresas pra quem prestamos serviço.</p>
        </div>
        <Link href="/empresas/novo">
          <Button className="w-full md:w-auto">
            <Plus className="h-4 w-4" /> Nova empresa
          </Button>
        </Link>
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
            searchPlaceholder="Buscar por nome, CNPJ, contato…"
            filters={
              <>
                <ToolbarFilterSelect
                  label="Papel"
                  value={tableState.filters.papel}
                  onChange={(v) => tableState.setFilter("papel", v)}
                  options={[
                    { value: "AMBOS", label: "Ambos" },
                    { value: "RECEBE_PLANILHA", label: "Recebe planilha" },
                    { value: "MANDA_FECHAMENTO", label: "Manda fechamento" },
                  ]}
                />
                <ToolbarFilterSelect
                  label="Status"
                  value={tableState.filters.ativa}
                  onChange={(v) => tableState.setFilter("ativa", v)}
                  options={[
                    { value: "true", label: "Ativas" },
                    { value: "false", label: "Inativas" },
                  ]}
                />
              </>
            }
          />
        }
        emptyMessage="Nenhuma empresa cadastrada."
        renderMobileCard={(e) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.nome}</p>
                <p className="text-xs text-muted-foreground">{PAPEL_LABEL[e.papel]}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                {(e.papel === "RECEBE_PLANILHA" || e.papel === "AMBOS") && (
                  <Link href={`/empresas/${e.id}/layout-envio`}>
                    <Button variant="ghost" size="icon" title="Layout de envio">
                      <FileSpreadsheet className="h-4 w-4" />
                    </Button>
                  </Link>
                )}
                {(e.papel === "MANDA_FECHAMENTO" || e.papel === "AMBOS") && (
                  <Link href={`/empresas/${e.id}/layout-import`}>
                    <Button variant="ghost" size="icon" title="Layout de importação">
                      <FileInput className="h-4 w-4" />
                    </Button>
                  </Link>
                )}
                <Link href={`/empresas/${e.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <StatusToggle
                  active={e.ativa}
                  onChange={(next) => update.mutate({ id: e.id, body: { ativa: next } })}
                  size="sm"
                />
                <ExcluirButton
                  path="/admin/empresas"
                  id={e.id}
                  nomeRecurso={`a empresa "${e.nome}"`}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {e.cnpj && (
                <span>
                  <span className="text-muted-foreground">CNPJ: </span>
                  <span className="font-mono">{e.cnpj}</span>
                </span>
              )}
              <span className={e.ativa ? "text-green-700" : "text-muted-foreground"}>
                {e.ativa ? "ativa" : "inativa"}
              </span>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
