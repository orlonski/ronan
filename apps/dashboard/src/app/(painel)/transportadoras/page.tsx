"use client";

import { useMemo } from "react";
import { Pencil, Plus, Truck, Users } from "lucide-react";
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
import { useApiQuery, usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Transportadora = {
  id: string;
  nome: string;
  cnpj: string | null;
  contato: string | null;
  ativa: boolean;
  criadoPor: { id: string; nome: string } | null;
  _count: { motoristas: number; veiculos: number; usuarios: number };
};

const PATH = "/admin/transportadoras";

export default function TransportadorasPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Transportadora>(PATH, tableState);
  const update = useUpdateResource<Partial<Transportadora>, Transportadora>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("transportadoras");
  const naoClassificados = useApiQuery<{ motoristas: number; veiculos: number }>(
    `${PATH}/nao-classificados`,
  );

  const columns = useMemo<ColumnDef<Transportadora>[]>(
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
        id: "frota",
        enableSorting: false,
        header: "Frota",
        cell: ({ row }) => {
          const c = row.original._count;
          return (
            <span className="text-sm text-muted-foreground">
              {c.motoristas} motorista{c.motoristas === 1 ? "" : "s"} · {c.veiculos} placa
              {c.veiculos === 1 ? "" : "s"}
            </span>
          );
        },
      },
      {
        id: "contato",
        enableSorting: false,
        header: "Contato",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.contato ?? "—"}
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
        size: 120,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex justify-center">
              <Permitido chave="transportadoras.editar">
                <Link href={`/transportadoras/${t.id}`} title="Editar">
                  <Button variant="ghost" size="icon">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
              </Permitido>
              <ExcluirButton
                perm="transportadoras.excluir"
                path={PATH}
                id={t.id}
                nomeRecurso={`a transportadora "${t.nome}"`}
              />
            </div>
          );
        },
      },
    ],
    [update],
  );

  const semDono = naoClassificados.data;
  const temSemDono = !!semDono && (semDono.motoristas > 0 || semDono.veiculos > 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transportadoras</h1>
          <p className="text-sm text-muted-foreground">
            As frotas donas dos caminhões e dos motoristas — a nossa e as que rodam pra
            gente. Não confundir com Empresas-cliente, que é pra quem prestamos serviço.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="transportadoras.criar">
            <Link href="/transportadoras/novo">
              <Button>
                <Plus className="h-4 w-4" /> Nova transportadora
              </Button>
            </Link>
          </Permitido>
        </div>
      </header>

      {temSemDono && (
        <Card className="border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Ainda sem transportadora:{" "}
            {semDono.motoristas > 0 && (
              <Link href="/motoristas?semTransportadora=true" className="underline">
                {semDono.motoristas} motorista{semDono.motoristas === 1 ? "" : "s"}
              </Link>
            )}
            {semDono.motoristas > 0 && semDono.veiculos > 0 && " e "}
            {semDono.veiculos > 0 && (
              <Link href="/veiculos?semTransportadora=true" className="underline">
                {semDono.veiculos} placa{semDono.veiculos === 1 ? "" : "s"}
              </Link>
            )}
            .
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Enquanto não forem classificados, o que eles lançam fica sem dono e não aparece
            pra quem tem acesso restrito a uma frota. Ao classificar, o histórico que ainda
            estiver sem dono é adotado automaticamente.
          </p>
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
            searchPlaceholder="Buscar por nome, CNPJ, contato…"
            filters={
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
            }
          />
        }
        emptyMessage="Nenhuma transportadora cadastrada."
        viewMode={viewMode}
        renderMobileCard={(t) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <Truck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{t.nome}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge className="border-slate-200 bg-slate-50 text-slate-800">
                    <Users className="mr-1 h-3 w-3" />
                    {t._count.motoristas} motorista{t._count.motoristas === 1 ? "" : "s"} ·{" "}
                    {t._count.veiculos} placa{t._count.veiculos === 1 ? "" : "s"}
                  </Badge>
                  {t.cnpj && <span className="font-mono">{t.cnpj}</span>}
                  {t.contato && <span>{t.contato}</span>}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Permitido chave="transportadoras.editar">
                  <Link href={`/transportadoras/${t.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                  <StatusToggle
                    active={t.ativa}
                    onChange={(next) => update.mutate({ id: t.id, body: { ativa: next } })}
                    size="sm"
                  />
                </Permitido>
                <ExcluirButton
                  perm="transportadoras.excluir"
                  path={PATH}
                  id={t.id}
                  nomeRecurso={`a transportadora "${t.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
