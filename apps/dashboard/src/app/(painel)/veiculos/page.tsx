"use client";

import { useMemo } from "react";
import { Pencil, Plus, Truck } from "lucide-react";
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
import { TransportadoraCombobox } from "@/components/fk-comboboxes";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Veiculo = {
  id: string;
  placa: string;
  modelo: string | null;
  ativo: boolean;
  transportadoraId: string | null;
  transportadora: { id: string; nome: string } | null;
  criadoPor: { id: string; nome: string } | null;
};

const PATH = "/admin/veiculos";

/** Célula da frota: chama atenção pro que ainda não foi classificado. */
function FrotaCell({ t }: { t: { nome: string } | null }) {
  if (!t) {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800">Sem transportadora</Badge>
    );
  }
  return <span className="text-sm">{t.nome}</span>;
}

export default function VeiculosPage() {
  const tableState = useDataTableState({ defaultSort: { field: "placa", order: "asc" } });
  const list = usePaginatedList<Veiculo>(PATH, tableState);
  const update = useUpdateResource<Partial<Veiculo>, Veiculo>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("veiculos");

  const columns = useMemo<ColumnDef<Veiculo>[]>(
    () => [
      {
        id: "placa",
        accessorKey: "placa",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Placa" />,
        cell: ({ row }) => (
          <span className="font-mono font-medium">{row.original.placa}</span>
        ),
      },
      {
        id: "modelo",
        accessorKey: "modelo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Modelo" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.modelo ?? "—"}</span>
        ),
      },
      {
        id: "transportadora",
        accessorKey: "transportadora",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Transportadora" />
        ),
        cell: ({ row }) => <FrotaCell t={row.original.transportadora} />,
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 96,
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
        size: 120,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => {
          const v = row.original;
          return (
            <div className="flex justify-center">
              <Permitido chave="veiculos.editar">
                <Link href={`/veiculos/${v.id}`} title="Editar">
                  <Button variant="ghost" size="icon">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
              </Permitido>
              <ExcluirButton
                perm="veiculos.excluir"
                path={PATH}
                id={v.id}
                nomeRecurso={`o veículo "${v.placa}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Veículos</h1>
          <p className="text-sm text-muted-foreground">
            Os caminhões cadastrados e a frota dona de cada um.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="veiculos.criar">
            <Link href="/veiculos/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo veículo
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
            searchPlaceholder="Buscar por placa ou modelo…"
            filters={
              <>
                <TransportadoraCombobox
                  value={tableState.filters.transportadoraId}
                  onChange={(v) => tableState.setFilter("transportadoraId", v)}
                  placeholder="Transportadora"
                />
                <Combobox
                  value={tableState.filters.semTransportadora}
                  onChange={(v) => tableState.setFilter("semTransportadora", v)}
                  placeholder="Classificação"
                  showSearch={false}
                  options={[{ value: "true", label: "Sem transportadora" }]}
                />
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
              </>
            }
          />
        }
        emptyMessage="Nenhum veículo cadastrado."
        viewMode={viewMode}
        renderMobileCard={(v) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono font-medium">{v.placa}</span>
                  {v.modelo && (
                    <span className="truncate text-muted-foreground">{v.modelo}</span>
                  )}
                </div>
                <FrotaCell t={v.transportadora} />
              </div>

              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Permitido chave="veiculos.editar">
                  <Link href={`/veiculos/${v.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                  <StatusToggle
                    active={v.ativo}
                    onChange={(next) => update.mutate({ id: v.id, body: { ativo: next } })}
                    size="sm"
                  />
                </Permitido>
                <ExcluirButton
                  perm="veiculos.excluir"
                  path={PATH}
                  id={v.id}
                  nomeRecurso={`o veículo "${v.placa}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
