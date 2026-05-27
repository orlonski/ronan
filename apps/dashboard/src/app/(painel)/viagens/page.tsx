"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Camera, ExternalLink } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterDateRange,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { firstDayOfMonth, useDataTableState } from "@/hooks/use-data-table-state";
import { usePaginatedList, useResourceOptions } from "@/lib/client-api";
import { fmtBR, fmtNum } from "@/lib/fechamento-helpers";
import { ValorComMinimo } from "@/components/valor-com-minimo";

type Viagem = {
  id: string;
  data: string;
  toneladas: string;
  ticket: string;
  km: string;
  status: string;
  toneladasInformada: string;
  toneladasEfetiva: string;
  toneladasAjustada: boolean;
  kmInformado: string;
  kmEfetivo: string;
  kmAjustada: boolean;
  ocrCampos: string[];
  veiculo: { id: string; placa: string };
  motorista: { id: string; nome: string };
  cliente: { id: string; nome: string };
  material: { id: string; nome: string };
  localCarga: { id: string; nome: string; cidade: string; uf: string };
  localDescarga: { id: string; nome: string; cidade: string; uf: string };
  fotos: { id: string; storageKey: string }[];
};

type Motorista = { id: string; nome: string };
type Cliente = { id: string; nome: string };

const STATUS_VIAGEM_LABEL: Record<string, string> = {
  ENVIADA: "Aguardando",
  EM_CONFERENCIA: "Em conferência",
  OK: "OK",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
  RASCUNHO_OFFLINE: "Rascunho",
};

const STATUS_VIAGEM_COLOR: Record<string, string> = {
  ENVIADA: "bg-amber-100 text-amber-900 border-amber-200",
  EM_CONFERENCIA: "bg-purple-100 text-purple-800 border-purple-200",
  OK: "bg-green-100 text-green-800 border-green-200",
  DIVERGENTE: "bg-red-100 text-red-800 border-red-200",
  AJUSTADA: "bg-blue-100 text-blue-800 border-blue-200",
  RASCUNHO_OFFLINE: "bg-gray-100 text-gray-700 border-gray-200",
};

export default function ViagensPage() {
  const tableState = useDataTableState({
    defaultSort: { field: "data", order: "desc" },
    defaultFilters: { de: firstDayOfMonth() },
  });
  const list = usePaginatedList<Viagem>("/admin/viagens", tableState);
  const motoristas = useResourceOptions<Motorista>("/admin/motoristas");
  const clientes = useResourceOptions<Cliente>("/admin/clientes");

  const motoristaOptions = useMemo(
    () => (motoristas.data ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [motoristas.data],
  );
  const clienteOptions = useMemo(
    () => (clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome })),
    [clientes.data],
  );

  const columns = useMemo<ColumnDef<Viagem>[]>(
    () => [
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge className={STATUS_VIAGEM_COLOR[row.original.status] ?? ""}>
            {STATUS_VIAGEM_LABEL[row.original.status] ?? row.original.status}
          </Badge>
        ),
      },
      {
        id: "data",
        accessorKey: "data",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Data" />,
        cell: ({ row }) => <span className="text-sm">{fmtBR(row.original.data)}</span>,
      },
      {
        id: "placa",
        accessorKey: "veiculo.placa",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Placa" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.veiculo.placa}</span>
        ),
      },
      {
        id: "motorista",
        accessorKey: "motorista.nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Motorista" />,
        cell: ({ row }) => <span className="text-sm">{row.original.motorista.nome}</span>,
      },
      {
        id: "cliente",
        accessorKey: "cliente.nome",
        enableSorting: false,
        header: "Material / Cliente",
        cell: ({ row }) => (
          <div className="text-sm">
            <div className="font-medium">{row.original.material.nome}</div>
            <div className="text-xs text-muted-foreground">{row.original.cliente.nome}</div>
          </div>
        ),
      },
      {
        id: "trajeto",
        enableSorting: false,
        header: "Trajeto",
        cell: ({ row }) => (
          <div className="text-xs">
            <div className="flex items-center gap-1">
              <ArrowUp className="h-3 w-3 text-muted-foreground" />
              {row.original.localCarga.nome.length > 28
                ? row.original.localCarga.nome.slice(0, 25) + "..."
                : row.original.localCarga.nome}
            </div>
            <div className="flex items-center gap-1">
              <ArrowDown className="h-3 w-3 text-muted-foreground" />
              {row.original.localDescarga.nome.length > 28
                ? row.original.localDescarga.nome.slice(0, 25) + "..."
                : row.original.localDescarga.nome}
            </div>
          </div>
        ),
      },
      {
        id: "toneladas",
        accessorKey: "toneladas",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Toneladas" />,
        cell: ({ row }) => (
          <ValorComMinimo
            className="text-sm"
            efetivo={row.original.toneladasEfetiva}
            real={row.original.toneladasInformada}
            ajustada={row.original.toneladasAjustada}
            unidade="t"
            casas={3}
          />
        ),
      },
      {
        id: "ticket",
        accessorKey: "ticket",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ticket" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.ticket}
            {row.original.ocrCampos.length > 0 && (
              <span
                className="ml-1 text-xs text-indigo-600"
                title={`Campos pela IA: ${row.original.ocrCampos.join(", ")}`}
              >
                ✨
              </span>
            )}
          </span>
        ),
      },
      {
        id: "km",
        accessorKey: "km",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Km" />,
        cell: ({ row }) => (
          <ValorComMinimo
            className="text-sm"
            efetivo={row.original.kmEfetivo}
            real={row.original.kmInformado}
            ajustada={row.original.kmAjustada}
            unidade="km"
            casas={2}
          />
        ),
      },
      {
        id: "acoes",
        size: 90,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-1">
            {row.original.fotos.length > 0 && (
              <Camera className="h-4 w-4 text-muted-foreground" />
            )}
            <Link href={`/viagens/${row.original.id}`}>
              <span className="rounded p-1 hover:bg-muted">
                <ExternalLink className="h-4 w-4" />
              </span>
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
          <h1 className="text-2xl font-semibold tracking-tight">Viagens</h1>
          <p className="text-sm text-muted-foreground">
            Lançamentos dos motoristas, com status visual de conferência.
          </p>
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
            searchPlaceholder="Buscar por ticket, motorista, placa, cliente…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.status}
                  onChange={(v) => tableState.setFilter("status", v)}
                  placeholder="Status"
                  showSearch={false}
                  options={[
                    { value: "ENVIADA", label: "Aguardando" },
                    { value: "EM_CONFERENCIA", label: "Em conferência" },
                    { value: "OK", label: "OK" },
                    { value: "DIVERGENTE", label: "Divergente" },
                    { value: "AJUSTADA", label: "Ajustada" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.motoristaId}
                  onChange={(v) => tableState.setFilter("motoristaId", v)}
                  placeholder="Motorista"
                  options={motoristaOptions}
                />
                <Combobox
                  value={tableState.filters.clienteId}
                  onChange={(v) => tableState.setFilter("clienteId", v)}
                  placeholder="Cliente"
                  options={clienteOptions}
                />
                <ToolbarFilterDateRange state={tableState} label="Período" />
              </>
            }
          />
        }
        emptyMessage="Nenhuma viagem nesse filtro."
        renderMobileCard={(v) => (
          <Link href={`/viagens/${v.id}`} className="block">
            <Card className="space-y-3 p-4 hover:bg-muted/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{v.cliente.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtBR(v.data)} · {v.veiculo.placa} · {v.motorista.nome}
                  </p>
                </div>
                <Badge className={STATUS_VIAGEM_COLOR[v.status] ?? ""}>
                  {STATUS_VIAGEM_LABEL[v.status] ?? v.status}
                </Badge>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <ArrowUp className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{v.localCarga.nome}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{v.localDescarga.nome}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
                <span>
                  <span className="text-muted-foreground">Material: </span>
                  {v.material.nome}
                </span>
                <span>
                  <span className="text-muted-foreground">T: </span>
                  <ValorComMinimo
                    className="font-medium"
                    efetivo={v.toneladasEfetiva}
                    real={v.toneladasInformada}
                    ajustada={v.toneladasAjustada}
                    unidade=""
                    casas={3}
                  />
                </span>
                <span>
                  <span className="text-muted-foreground">km: </span>
                  <ValorComMinimo
                    className="font-medium"
                    efetivo={v.kmEfetivo}
                    real={v.kmInformado}
                    ajustada={v.kmAjustada}
                    unidade=""
                    casas={2}
                  />
                </span>
                <span>
                  <span className="text-muted-foreground">Ticket: </span>
                  <span className="font-mono">{v.ticket}</span>
                </span>
                {v.fotos.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    {v.fotos.length}
                  </span>
                )}
              </div>
            </Card>
          </Link>
        )}
      />
    </div>
  );
}
