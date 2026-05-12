"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Camera, ExternalLink } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterDateRange,
  ToolbarFilterSelect,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useAuthToken, fetchApi, useResourceOptions } from "@/lib/client-api";
import type { Pagination } from "@/lib/client-api";
import type { DataTableParams } from "@/hooks/use-data-table-state";
import { fmtNum } from "@/lib/fechamento-helpers";
import { useQuery } from "@tanstack/react-query";

type Abastecimento = {
  id: string;
  data: string;
  tipo: string;
  litros: string;
  valorTotal: string;
  precoLitro: string | null;
  odometro: number;
  postoNome: string | null;
  tanqueCheio: boolean;
  veiculo: { id: string; placa: string; modelo: string | null };
  motorista: { id: string; nome: string };
  _count: { fotos: number };
};

type Motorista = { id: string; nome: string };

type ListaAbastecimentos = {
  data: Abastecimento[];
  pagination: Pagination;
  totais: { count: number; litros: string; valor: string };
};

const TIPO_LABEL: Record<string, string> = {
  DIESEL_S10: "Diesel S10",
  DIESEL_S500: "Diesel S500",
  ARLA_32: "ARLA 32",
  GASOLINA: "Gasolina",
  ETANOL: "Etanol",
};

const TIPO_COLOR: Record<string, string> = {
  DIESEL_S10: "bg-blue-100 text-blue-800 border-blue-200",
  DIESEL_S500: "bg-indigo-100 text-indigo-800 border-indigo-200",
  ARLA_32: "bg-cyan-100 text-cyan-800 border-cyan-200",
  GASOLINA: "bg-amber-100 text-amber-900 border-amber-200",
  ETANOL: "bg-green-100 text-green-800 border-green-200",
};

export default function AbastecimentosPage() {
  const token = useAuthToken();
  const tableState = useDataTableState({ defaultSort: { field: "data", order: "desc" } });
  const motoristas = useResourceOptions<Motorista>("/admin/motoristas");

  const url = buildUrl("/admin/abastecimentos", tableState);
  const list = useQuery({
    queryKey: ["abastecimentos-admin", url, token],
    enabled: !!token,
    queryFn: () => fetchApi<ListaAbastecimentos>(url, { token }),
    placeholderData: (prev) => prev,
  });

  const motoristaOptions = useMemo(
    () => (motoristas.data ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [motoristas.data],
  );

  const columns = useMemo<ColumnDef<Abastecimento>[]>(
    () => [
      {
        id: "tipo",
        accessorKey: "tipo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
        cell: ({ row }) => (
          <Badge className={TIPO_COLOR[row.original.tipo] ?? ""}>
            {TIPO_LABEL[row.original.tipo] ?? row.original.tipo}
          </Badge>
        ),
      },
      {
        id: "data",
        accessorKey: "data",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Data" />,
        cell: ({ row }) => <span className="text-sm">{fmtData(row.original.data)}</span>,
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
        id: "posto",
        enableSorting: false,
        header: "Posto",
        cell: ({ row }) =>
          row.original.postoNome ?? <span className="text-muted-foreground">—</span>,
      },
      {
        id: "litros",
        accessorKey: "litros",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Litros" />,
        cell: ({ row }) => <span className="text-sm">{fmtNum(row.original.litros, 2)}</span>,
      },
      {
        id: "valorTotal",
        accessorKey: "valorTotal",
        header: ({ column }) => <DataTableColumnHeader column={column} title="R$ total" />,
        cell: ({ row }) => (
          <span className="text-sm">R$ {fmtNum(row.original.valorTotal, 2)}</span>
        ),
      },
      {
        id: "precoLitro",
        enableSorting: false,
        header: "R$/L",
        cell: ({ row }) =>
          row.original.precoLitro ? `R$ ${fmtNum(row.original.precoLitro, 3)}` : "—",
      },
      {
        id: "odometro",
        accessorKey: "odometro",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Odômetro" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.odometro.toLocaleString("pt-BR")}
          </span>
        ),
      },
      {
        id: "acoes",
        size: 90,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-1">
            {row.original._count.fotos > 0 && (
              <Camera className="h-4 w-4 text-muted-foreground" />
            )}
            <Link href={`/abastecimentos/${row.original.id}`}>
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
          <h1 className="text-2xl font-semibold tracking-tight">Abastecimentos</h1>
          <p className="text-sm text-muted-foreground">
            Combustível registrado pelos motoristas, com odômetro e foto.
          </p>
        </div>
      </header>

      {list.data && list.data.totais.count > 0 && (
        <Card className="grid grid-cols-3 gap-4 p-4">
          <Resumo label="Abastecimentos" value={list.data.totais.count.toLocaleString("pt-BR")} />
          <Resumo label="Litros" value={`${fmtNum(list.data.totais.litros, 2)} L`} />
          <Resumo label="Valor total" value={`R$ ${fmtNum(list.data.totais.valor, 2)}`} />
        </Card>
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
            searchPlaceholder="Buscar por posto, motorista, placa, obs…"
            filters={
              <>
                <ToolbarFilterSelect
                  label="Tipo"
                  value={tableState.filters.tipo}
                  onChange={(v) => tableState.setFilter("tipo", v)}
                  options={[
                    { value: "DIESEL_S10", label: "Diesel S10" },
                    { value: "DIESEL_S500", label: "Diesel S500" },
                    { value: "ARLA_32", label: "ARLA 32" },
                    { value: "GASOLINA", label: "Gasolina" },
                    { value: "ETANOL", label: "Etanol" },
                  ]}
                />
                <ToolbarFilterSelect
                  label="Motorista"
                  value={tableState.filters.motoristaId}
                  onChange={(v) => tableState.setFilter("motoristaId", v)}
                  options={motoristaOptions}
                />
                <ToolbarFilterDateRange state={tableState} label="Período" />
              </>
            }
          />
        }
        emptyMessage="Nenhum abastecimento nesse filtro."
        renderMobileCard={(a) => (
          <Link href={`/abastecimentos/${a.id}`} className="block">
            <Card className="space-y-3 p-4 hover:bg-muted/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {a.postoNome ?? "Posto não informado"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtData(a.data)} · {a.veiculo.placa} · {a.motorista.nome}
                  </p>
                </div>
                <Badge className={TIPO_COLOR[a.tipo] ?? ""}>
                  {TIPO_LABEL[a.tipo] ?? a.tipo}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
                <span>
                  <span className="text-muted-foreground">L: </span>
                  <span className="font-medium">{fmtNum(a.litros, 2)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">R$: </span>
                  <span className="font-medium">{fmtNum(a.valorTotal, 2)}</span>
                </span>
                {a.precoLitro && (
                  <span>
                    <span className="text-muted-foreground">R$/L: </span>
                    <span className="font-medium">{fmtNum(a.precoLitro, 3)}</span>
                  </span>
                )}
                <span>
                  <span className="text-muted-foreground">km: </span>
                  <span className="font-mono">
                    {a.odometro.toLocaleString("pt-BR")}
                  </span>
                </span>
                {a._count.fotos > 0 && (
                  <span className="flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    {a._count.fotos}
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

function buildUrl(path: string, params: Partial<DataTableParams>): string {
  const usp = new URLSearchParams();
  if (params.page && params.page > 1) usp.set("page", String(params.page));
  if (params.pageSize) usp.set("pageSize", String(params.pageSize));
  if (params.sort) usp.set("sort", params.sort);
  if (params.order && params.order !== "asc") usp.set("order", params.order);
  if (params.q) usp.set("q", params.q);
  if (params.filters) {
    for (const [k, v] of Object.entries(params.filters)) {
      if (v != null && v !== "") usp.set(k, v);
    }
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

function Resumo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function fmtData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
