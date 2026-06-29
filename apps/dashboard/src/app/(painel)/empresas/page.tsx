"use client";

import { useMemo } from "react";
import {
  Building2,
  FileSpreadsheet,
  FileInput,
  Pencil,
  Plus,
} from "lucide-react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Badge } from "@/components/ui/badge";
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

type Papel = "RECEBE_PLANILHA" | "MANDA_FECHAMENTO" | "AMBOS";
type Empresa = {
  id: string; nome: string; cnpj: string | null; contato: string | null;
  papel: Papel; ativa: boolean;
  criadoPor: { id: string; nome: string } | null;
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
  const { viewMode, setViewMode } = useListViewMode("empresas");

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
              <Permitido chave="empresas.editar">
                <Link href={`/empresas/${e.id}`} title="Editar">
                  <Button variant="ghost" size="icon">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
              </Permitido>
              <ExcluirButton perm="empresas.excluir"
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
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="empresas.criar">
            <Link href="/empresas/novo">
              <Button>
                <Plus className="h-4 w-4" /> Nova empresa
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
        toolbar={
          <DataTableToolbar
            state={tableState}
            searchPlaceholder="Buscar por nome, CNPJ, contato…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.papel}
                  onChange={(v) => tableState.setFilter("papel", v)}
                  placeholder="Papel"
                  showSearch={false}
                  options={[
                    { value: "AMBOS", label: "Ambos" },
                    { value: "RECEBE_PLANILHA", label: "Recebe planilha" },
                    { value: "MANDA_FECHAMENTO", label: "Manda fechamento" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.ativa}
                  onChange={(v) => tableState.setFilter("ativa", v)}
                  placeholder="Status"
                  showSearch={false}
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
        viewMode={viewMode}
        renderMobileCard={(e) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
              <Badge className="border-slate-200 bg-slate-50 text-slate-800">
                {PAPEL_LABEL[e.papel]}
              </Badge>

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{e.nome}</span>
                </div>
                {(e.cnpj || e.contato) && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {e.cnpj && <span className="font-mono">{e.cnpj}</span>}
                    {e.cnpj && e.contato && <span>·</span>}
                    {e.contato && <span>{e.contato}</span>}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
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
                <Permitido chave="empresas.editar">
                  <Link href={`/empresas/${e.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                </Permitido>
                <Permitido chave="empresas.editar">
                  <StatusToggle
                    active={e.ativa}
                    onChange={(next) =>
                      update.mutate({ id: e.id, body: { ativa: next } })
                    }
                    size="sm"
                  />
                </Permitido>
                <ExcluirButton perm="empresas.excluir"
                  path="/admin/empresas"
                  id={e.id}
                  nomeRecurso={`a empresa "${e.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
