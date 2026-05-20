"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileSpreadsheet, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterSelect,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useResourceOptions } from "@/lib/client-api";
import { useFechamentos, type FechamentoLista } from "@/lib/fechamentos-api";
import {
  STATUS_FECHAMENTO_COLOR,
  STATUS_FECHAMENTO_LABEL,
  fmtBR,
  fmtDataHoraBR,
} from "@/lib/fechamento-helpers";

type Empresa = { id: string; nome: string };

export default function FechamentosPage() {
  const tableState = useDataTableState({
    defaultSort: { field: "criadoEm", order: "desc" },
  });
  const list = useFechamentos(tableState);
  const empresas = useResourceOptions<Empresa>("/admin/empresas");

  const empresaOptions = useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const columns = useMemo<ColumnDef<FechamentoLista>[]>(
    () => [
      {
        id: "empresa",
        accessorKey: "empresa.nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Empresa" />,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.empresa.nome}</span>
        ),
      },
      {
        id: "periodoInicio",
        accessorKey: "periodoInicio",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Período" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {fmtBR(row.original.periodoInicio)} → {fmtBR(row.original.periodoFim)}
          </span>
        ),
      },
      {
        id: "versao",
        accessorKey: "versao",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Versão" />,
        cell: ({ row }) => <span className="text-sm">v{row.original.versao}</span>,
      },
      {
        id: "linhas",
        enableSorting: false,
        header: "Linhas",
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original._count.linhas}
            {row.original.resumoIa && (
              <span className="ml-2 text-xs text-muted-foreground">
                ({row.original.resumoIa.matchAuto + row.original.resumoIa.matchIa} OK ·{" "}
                {row.original.resumoIa.divergencia} pendentes)
              </span>
            )}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge className={STATUS_FECHAMENTO_COLOR[row.original.status]}>
            {STATUS_FECHAMENTO_LABEL[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "criadoEm",
        accessorKey: "criadoEm",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Recebido" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {fmtDataHoraBR(row.original.criadoEm)}
          </span>
        ),
      },
      {
        id: "acoes",
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Link href={`/fechamentos/${row.original.id}`}>
              <Button variant="ghost" size="sm">
                <FileSpreadsheet className="h-4 w-4" /> Abrir
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
          <h1 className="text-2xl font-semibold tracking-tight">Fechamentos</h1>
          <p className="text-sm text-muted-foreground">
            Conferências de planilhas que as empresas enviam — extração + match automático com IA.
          </p>
        </div>
        <Link href="/fechamentos/novo">
          <Button className="w-full md:w-auto">
            <Plus className="h-4 w-4" /> Novo fechamento
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
            searchPlaceholder="Buscar por nome do arquivo ou empresa…"
            filters={
              <>
                <ToolbarFilterSelect
                  label="Empresa"
                  value={tableState.filters.empresaId}
                  onChange={(v) => tableState.setFilter("empresaId", v)}
                  options={empresaOptions}
                />
                <ToolbarFilterSelect
                  label="Status"
                  value={tableState.filters.status}
                  onChange={(v) => tableState.setFilter("status", v)}
                  options={[
                    { value: "RECEBIDO", label: "Recebido" },
                    { value: "EM_PROCESSAMENTO", label: "Em processamento" },
                    { value: "AGUARDANDO_REVISAO", label: "Aguardando revisão" },
                    { value: "CONFERIDO", label: "Conferido" },
                    { value: "EXPORTADO", label: "Exportado" },
                  ]}
                />
                <ToolbarFilterSelect
                  label="Substituídos"
                  value={tableState.filters.incluirSubstituidos}
                  onChange={(v) => tableState.setFilter("incluirSubstituidos", v)}
                  options={[{ value: "true", label: "Incluir" }]}
                  placeholder="Esconder"
                />
              </>
            }
          />
        }
        emptyMessage='Nenhum fechamento ainda. Clique em "Novo fechamento" pra subir a primeira planilha.'
        renderMobileCard={(f) => (
          <Link href={`/fechamentos/${f.id}`} className="block">
            <Card className="space-y-3 p-4 hover:bg-muted/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.empresa.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtBR(f.periodoInicio)} → {fmtBR(f.periodoFim)} · v{f.versao}
                  </p>
                </div>
                <Badge className={STATUS_FECHAMENTO_COLOR[f.status]}>
                  {STATUS_FECHAMENTO_LABEL[f.status]}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
                <span>
                  <span className="text-muted-foreground">Linhas: </span>
                  <span className="font-medium">{f._count.linhas}</span>
                </span>
                {f.resumoIa && (
                  <span>
                    <span className="text-muted-foreground">OK: </span>
                    <span className="font-medium">
                      {f.resumoIa.matchAuto + f.resumoIa.matchIa}
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      · {f.resumoIa.divergencia} pendentes
                    </span>
                  </span>
                )}
                <span className="text-muted-foreground">
                  Recebido {fmtDataHoraBR(f.criadoEm)}
                </span>
              </div>
            </Card>
          </Link>
        )}
      />
    </div>
  );
}
