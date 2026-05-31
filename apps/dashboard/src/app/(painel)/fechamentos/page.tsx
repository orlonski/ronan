"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Building2, ChevronRight, FileSpreadsheet, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
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
import { ListMetric } from "@/components/list-metric";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
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
  const { viewMode, setViewMode } = useListViewMode("fechamentos");

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
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Link href="/fechamentos/novo">
            <Button>
              <Plus className="h-4 w-4" /> Novo fechamento
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
            searchPlaceholder="Buscar por nome do arquivo ou empresa…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.empresaId}
                  onChange={(v) => tableState.setFilter("empresaId", v)}
                  placeholder="Empresa"
                  options={empresaOptions}
                />
                <Combobox
                  value={tableState.filters.status}
                  onChange={(v) => tableState.setFilter("status", v)}
                  placeholder="Status"
                  showSearch={false}
                  options={[
                    { value: "RECEBIDO", label: "Recebido" },
                    { value: "EM_PROCESSAMENTO", label: "Em processamento" },
                    { value: "AGUARDANDO_REVISAO", label: "Aguardando revisão" },
                    { value: "CONFERIDO", label: "Conferido" },
                    { value: "EXPORTADO", label: "Exportado" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.incluirSubstituidos}
                  onChange={(v) => tableState.setFilter("incluirSubstituidos", v)}
                  placeholder="Substituídos: esconder"
                  showSearch={false}
                  options={[{ value: "true", label: "Incluir substituídos" }]}
                />
              </>
            }
          />
        }
        emptyMessage='Nenhum fechamento ainda. Clique em "Novo fechamento" pra subir a primeira planilha.'
        viewMode={viewMode}
        renderMobileCard={(f) => (
          <Link href={`/fechamentos/${f.id}`} className="group block">
            <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
                <Badge className={STATUS_FECHAMENTO_COLOR[f.status]}>
                  {STATUS_FECHAMENTO_LABEL[f.status]}
                </Badge>

                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{f.empresa.nome}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {fmtBR(f.periodoInicio)} → {fmtBR(f.periodoFim)}
                    </span>
                    <span>·</span>
                    <span>v{f.versao}</span>
                    <span>·</span>
                    <span>Recebido {fmtDataHoraBR(f.criadoEm)}</span>
                    {f.criadoPor && (
                      <>
                        <span>·</span>
                        <span>por {f.criadoPor.nome}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex gap-4">
                    <ListMetric label="Linhas" width={70} value={f._count.linhas} />
                    <ListMetric
                      label="OK"
                      width={70}
                      value={
                        f.resumoIa
                          ? f.resumoIa.matchAuto + f.resumoIa.matchIa
                          : "—"
                      }
                    />
                    <ListMetric
                      label="Pendentes"
                      width={80}
                      value={
                        f.resumoIa ? (
                          <span
                            className={
                              f.resumoIa.divergencia > 0
                                ? "text-amber-700"
                                : "text-emerald-700"
                            }
                          >
                            {f.resumoIa.divergencia}
                          </span>
                        ) : (
                          "—"
                        )
                      }
                    />
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Card>
          </Link>
        )}
      />
    </div>
  );
}
