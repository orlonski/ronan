"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil, Truck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { fmtBR } from "@/lib/fechamento-helpers";
import { usePaginatedList } from "@/lib/client-api";
import { STATUS_VIAGEM_COLOR, STATUS_VIAGEM_LABEL } from "@/lib/status-viagem";

type Viagem = {
  id: string;
  data: string;
  ticket: string;
  status: string;
  motorista: { id: string; nome: string };
  cliente?: { id: string; nome: string } | null;
  localCarga: { id: string; nome: string };
  localDescarga: { id: string; nome: string };
};

export function ViagensDoLocal({
  localId,
  totalViagens,
}: {
  localId: string;
  totalViagens?: number;
}) {
  const tableState = useDataTableState({ defaultSort: { field: "data", order: "desc" } });
  const viagens = usePaginatedList<Viagem>("/admin/viagens", {
    ...tableState,
    filters: { ...tableState.filters, localId },
  });

  function lado(v: Viagem): "Carga" | "Descarga" | "Carga e descarga" {
    const carga = v.localCarga?.id === localId;
    const descarga = v.localDescarga?.id === localId;
    if (carga && descarga) return "Carga e descarga";
    return carga ? "Carga" : "Descarga";
  }

  const columns = useMemo<ColumnDef<Viagem>[]>(
    () => [
      {
        id: "data",
        accessorKey: "data",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Data" />,
        cell: ({ row }) => <span className="text-sm">{fmtBR(row.original.data)}</span>,
      },
      {
        id: "ticket",
        accessorKey: "ticket",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ticket" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.ticket}</span>
        ),
      },
      {
        id: "lado",
        enableSorting: false,
        header: "Lado",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{lado(row.original)}</span>
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
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cliente" />,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.cliente?.nome ?? "—"}</span>
        ),
      },
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
        id: "acoes",
        size: 80,
        enableSorting: false,
        header: () => <span className="block text-center">Abrir</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Link href={`/viagens/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Abrir viagem">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localId],
  );

  return (
    <Card className="space-y-3 p-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-muted-foreground" /> Viagens deste local
        {totalViagens != null && (
          <span className="text-muted-foreground">({totalViagens})</span>
        )}
      </div>
      <DataTable
        columns={columns}
        data={viagens.data?.data ?? []}
        pagination={viagens.data?.pagination}
        state={tableState}
        isLoading={viagens.isLoading}
        isFetching={viagens.isFetching}
        emptyMessage="Nenhuma viagem usou este local ainda."
      />
    </Card>
  );
}
