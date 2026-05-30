"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/data-table";
import { ExcluirButton } from "@/components/excluir-button";
import { StatusToggle } from "@/components/status-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import {
  fetchApi,
  useAuthToken,
  usePaginatedList,
  useUpdateResource,
} from "@/lib/client-api";

const PATH = "/admin/pedagios-rodovia";

type PedagioRodovia = {
  id: string;
  nome: string;
  concessionaria: string | null;
  rodovia: string | null;
  cidade: string | null;
  uf: string | null;
  lat: number;
  lng: number;
  valorBase: string | null;
  ativo: boolean;
  fonte: string;
  osmId: string | null;
};

export default function PedagiosRodoviaPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<PedagioRodovia>(PATH, tableState);
  const update = useUpdateResource<Record<string, unknown>, PedagioRodovia>(PATH, PATH);
  const token = useAuthToken();
  const qc = useQueryClient();
  const [resultado, setResultado] = useState<string | null>(null);

  const importar = useMutation({
    mutationFn: () =>
      fetchApi<{ criados: number; atualizados: number }>(
        `${PATH}/importar-osm`,
        { method: "POST", token },
      ),
    onSuccess: (r) => {
      setResultado(`Importação concluída: ${r.criados} novos, ${r.atualizados} atualizados.`);
      void qc.invalidateQueries({ queryKey: [PATH] });
    },
    onError: (e: Error) => {
      setResultado(`Falha na importação: ${e.message}`);
    },
  });

  const columns = useMemo<ColumnDef<PedagioRodovia>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "rodovia",
        enableSorting: false,
        header: "Rodovia",
        cell: ({ row }) => row.original.rodovia ?? "—",
      },
      {
        id: "concessionaria",
        enableSorting: false,
        header: "Concessionária",
        cell: ({ row }) => row.original.concessionaria ?? "—",
      },
      {
        id: "uf",
        accessorKey: "uf",
        header: ({ column }) => <DataTableColumnHeader column={column} title="UF" />,
        cell: ({ row }) => row.original.uf ?? "—",
      },
      {
        id: "fonte",
        enableSorting: false,
        header: "Fonte",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.fonte}</span>
        ),
      },
      {
        id: "acoes",
        size: 140,
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
            <ExcluirButton
              path={PATH}
              id={row.original.id}
              nomeRecurso={`o pedágio "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Pedágios (rodovias)</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de pedágios pra alertar motorista quando salvar viagem sem valor de
            pedágio numa rota que passa por um deles. Importa do OpenStreetMap.
          </p>
        </div>
        <Button
          onClick={() => importar.mutate()}
          disabled={importar.isPending}
          variant="outline"
        >
          {importar.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" /> Importando…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" /> Importar do OpenStreetMap
            </>
          )}
        </Button>
      </header>

      {resultado && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          {resultado}
        </div>
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
            searchPlaceholder="Buscar por nome, rodovia, concessionária, cidade…"
          />
        }
        emptyMessage="Nenhum pedágio cadastrado. Importe do OpenStreetMap pra começar."
      />
    </div>
  );
}
