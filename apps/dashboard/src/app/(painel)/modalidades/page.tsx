"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableColumnHeader, DataTableToolbar } from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Modalidade = {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  exigeFotoCupom: boolean;
  exigeFotoOdometro: boolean;
  exigeFotoBomba: boolean;
  _count?: { motoristas: number };
};

const PATH = "/admin/modalidades";

/** Resumo textual das fotos exigidas — o mesmo padrão da tela de modos de serviço. */
function resumoFotos(m: Modalidade): string {
  const itens = [
    m.exigeFotoCupom && "cupom",
    m.exigeFotoOdometro && "odômetro",
    m.exigeFotoBomba && "bomba",
  ].filter(Boolean);
  return itens.length ? itens.join(" · ") : "nenhuma foto";
}

export default function ModalidadesPage() {
  const tableState = useDataTableState({ defaultSort: { field: "ordem", order: "asc" } });
  const list = usePaginatedList<Modalidade>(PATH, tableState);
  const update = useUpdateResource<{ ativo?: boolean }, Modalidade>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("modalidades");

  const columns = useMemo<ColumnDef<Modalidade>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "fotos",
        enableSorting: false,
        header: "Exige no abastecimento",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{resumoFotos(row.original)}</span>
        ),
      },
      {
        id: "motoristas",
        enableSorting: false,
        size: 120,
        header: "Motoristas",
        cell: ({ row }) => (
          <span className="text-sm tabular-nums text-muted-foreground">
            {row.original._count?.motoristas ?? 0}
          </span>
        ),
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 128,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Permitido chave="modalidades.editar">
            <StatusToggle
              active={row.original.ativo}
              onChange={(next) => update.mutate({ id: row.original.id, body: { ativo: next } })}
              size="sm"
              label
            />
          </Permitido>
        ),
      },
      {
        id: "acoes",
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Permitido chave="modalidades.editar">
              <Link href={`/modalidades/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            <ExcluirButton
              perm="modalidades.excluir"
              path={PATH}
              id={row.original.id}
              nomeRecurso={`a modalidade "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Modalidades do motorista</h1>
          <p className="text-sm text-muted-foreground">
            O vínculo de cada motorista (próprio, agregado, terceiro…) e o que o app
            exige de foto no abastecimento em cada um. Motorista sem modalidade segue
            como sempre.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="modalidades.criar">
            <Link href="/modalidades/novo">
              <Button>
                <Plus className="h-4 w-4" /> Nova modalidade
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
            searchPlaceholder="Buscar modalidade…"
            filters={
              <Combobox
                value={tableState.filters.ativo}
                onChange={(v) => tableState.setFilter("ativo", v)}
                placeholder="Status"
                showSearch={false}
                options={[
                  { value: "true", label: "Ativas" },
                  { value: "false", label: "Inativas" },
                ]}
              />
            }
          />
        }
        emptyMessage="Nenhuma modalidade cadastrada — os motoristas seguem sem classificação."
        viewMode={viewMode}
        renderMobileCard={(m) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
              <div className="min-w-0 space-y-1">
                <span className="truncate font-medium">{m.nome}</span>
                <p className="text-xs text-muted-foreground">{resumoFotos(m)}</p>
                <p className="text-xs text-muted-foreground">
                  {m._count?.motoristas ?? 0} motorista(s)
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Permitido chave="modalidades.editar">
                  <StatusToggle
                    active={m.ativo}
                    onChange={(next) => update.mutate({ id: m.id, body: { ativo: next } })}
                    size="sm"
                  />
                </Permitido>
                <Permitido chave="modalidades.editar">
                  <Link href={`/modalidades/${m.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                </Permitido>
                <ExcluirButton
                  perm="modalidades.excluir"
                  path={PATH}
                  id={m.id}
                  nomeRecurso={`a modalidade "${m.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
