"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil, Plus, Star } from "lucide-react";
import { BadgeMedicao } from "./_components/badge-medicao";
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

type TipoServico = {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  padrao: boolean;
  ordem: number;
  medicao: "PESO" | "PERIODO";
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
};

const PATH = "/admin/tipos-servico";

export default function TiposServicoPage() {
  const tableState = useDataTableState({ defaultSort: { field: "ordem", order: "asc" } });
  const list = usePaginatedList<TipoServico>(PATH, tableState);
  const update = useUpdateResource<{ ativo?: boolean }, TipoServico>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("tipos-servico");

  const columns = useMemo<ColumnDef<TipoServico>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.nome}</span>
            {row.original.padrao && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                title="É o modo que vale pras viagens que não escolhem nenhum."
              >
                <Star className="h-3 w-3" /> padrão
              </span>
            )}
          </div>
        ),
      },
      {
        id: "medicao",
        enableSorting: false,
        size: 140,
        header: "Medição",
        cell: ({ row }) => <BadgeMedicao medicao={row.original.medicao} />,
      },
      {
        id: "exige",
        enableSorting: false,
        header: "Pede ao motorista",
        cell: ({ row }) => {
          const t = row.original;
          const itens = [
            t.medicao === "PERIODO" ? "entrada/saída" : "peso",
            t.exigeMaterial && "material",
            t.exigeTicket && "ticket",
            t.exigeLocalDescarga && "descarga",
            t.exigeKm && "km",
          ].filter(Boolean);
          return <span className="text-xs text-muted-foreground">{itens.join(" · ")}</span>;
        },
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 128,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Permitido chave="tipos-servico.editar">
            <StatusToggle
              active={row.original.ativo}
              onChange={(next) => update.mutate({ id: row.original.id, body: { ativo: next } })}
              size="sm"
              label
              // O padrão é o chão de toda viagem sem tipo — desativar quebraria
              // o histórico. O backend recusa; aqui a gente nem oferece.
              disabled={row.original.padrao}
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
            <Permitido chave="tipos-servico.editar">
              <Link href={`/tipos-servico/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            {!row.original.padrao && (
              <ExcluirButton
                perm="tipos-servico.excluir"
                path={PATH}
                id={row.original.id}
                nomeRecurso={`o modo de serviço "${row.original.nome}"`}
              />
            )}
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
          <h1 className="text-2xl font-semibold tracking-tight">Modos de serviço</h1>
          <p className="text-sm text-muted-foreground">
            Como a viagem é medida — por peso (frete) ou por período (diária) — e o que o
            app pede ao motorista em cada caso.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="tipos-servico.criar">
            <Link href="/tipos-servico/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo modo
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
            searchPlaceholder="Buscar modo de serviço…"
            filters={
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
            }
          />
        }
        emptyMessage="Nenhum modo de serviço cadastrado."
        viewMode={viewMode}
        renderMobileCard={(t) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="truncate font-medium">{t.nome}</span>
                  {t.padrao && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      <Star className="h-3 w-3" /> padrão
                    </span>
                  )}
                </div>
                <BadgeMedicao medicao={t.medicao} />
              </div>
              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Permitido chave="tipos-servico.editar">
                  <StatusToggle
                    active={t.ativo}
                    onChange={(next) => update.mutate({ id: t.id, body: { ativo: next } })}
                    size="sm"
                    disabled={t.padrao}
                  />
                </Permitido>
                <Permitido chave="tipos-servico.editar">
                  <Link href={`/tipos-servico/${t.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                </Permitido>
                {!t.padrao && (
                  <ExcluirButton
                    perm="tipos-servico.excluir"
                    path={PATH}
                    id={t.id}
                    nomeRecurso={`o modo de serviço "${t.nome}"`}
                  />
                )}
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
