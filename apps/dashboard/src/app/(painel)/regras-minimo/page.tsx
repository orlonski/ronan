"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Pencil, Plus, Ruler } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, DataTableToolbar } from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList, useResourceOptions, useUpdateResource } from "@/lib/client-api";

type Empresa = { id: string; nome: string };
type Regra = {
  id: string;
  empresa: Empresa;
  material: { id: string; nome: string } | null;
  kmFaixaDe: string;
  kmFaixaAte: string | null;
  kmMinimo: string | null;
  toneladasMinimo: string | null;
  ativo: boolean;
};

const PATH = "/admin/regras-minimo";

function fmtNum(v: string | null): string {
  if (v == null) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR") : v;
}

export default function RegrasMinimoPage() {
  const tableState = useDataTableState({ defaultSort: { field: "criadoEm", order: "desc" } });
  const list = usePaginatedList<Regra>(PATH, tableState);
  const empresas = useResourceOptions<Empresa>("/admin/empresas");
  const update = useUpdateResource<{ ativo?: boolean }, Regra>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("regras-minimo");

  const empresaOptions = useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const columns = useMemo<ColumnDef<Regra>[]>(
    () => [
      {
        id: "empresa",
        enableSorting: false,
        header: "Empresa",
        cell: ({ row }) => <span className="font-medium">{row.original.empresa.nome}</span>,
      },
      {
        id: "material",
        enableSorting: false,
        header: "Material",
        cell: ({ row }) =>
          row.original.material ? (
            row.original.material.nome
          ) : (
            <span className="text-muted-foreground">Qualquer</span>
          ),
      },
      {
        id: "faixa",
        enableSorting: false,
        header: "Faixa (km)",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {fmtNum(row.original.kmFaixaDe)} –{" "}
            {row.original.kmFaixaAte ? fmtNum(row.original.kmFaixaAte) : "∞"}
          </span>
        ),
      },
      {
        id: "kmMinimo",
        enableSorting: false,
        header: "Km mín",
        cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.kmMinimo) || "—"}</span>,
      },
      {
        id: "toneladasMinimo",
        enableSorting: false,
        header: "Ton mín",
        cell: ({ row }) => (
          <span className="tabular-nums">{fmtNum(row.original.toneladasMinimo) || "—"}</span>
        ),
      },
      {
        id: "ativo",
        size: 128,
        header: "Status",
        cell: ({ row }) => (
          <Permitido chave="regras-minimo.editar">
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
            <Permitido chave="regras-minimo.editar">
              <Link href={`/regras-minimo/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            <ExcluirButton
              perm="regras-minimo.excluir"
              path={PATH}
              id={row.original.id}
              nomeRecurso="esta regra de mínimo"
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
          <h1 className="text-2xl font-semibold tracking-tight">Mínimos por faixa</h1>
          <p className="text-sm text-muted-foreground">
            Km/toneladas mínimos faturados por empresa, material e faixa de km rodado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="regras-minimo.criar">
            <Link href="/regras-minimo/novo">
              <Button>
                <Plus className="h-4 w-4" /> Nova regra
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
            searchPlaceholder="Buscar por empresa ou material…"
            filters={
              <Combobox
                value={tableState.filters.empresaId}
                onChange={(v) => tableState.setFilter("empresaId", v)}
                placeholder="Empresa"
                options={empresaOptions}
              />
            }
          />
        }
        emptyMessage="Nenhuma regra cadastrada."
        viewMode={viewMode}
        renderMobileCard={(r) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <Ruler className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">{r.empresa.nome}</span>
              <span className="text-sm text-muted-foreground">
                · {r.material ? r.material.nome : "Qualquer"}
              </span>
            </div>
            <div className="text-sm tabular-nums text-muted-foreground">
              Faixa {fmtNum(r.kmFaixaDe)}–{r.kmFaixaAte ? fmtNum(r.kmFaixaAte) : "∞"} km · mín{" "}
              {fmtNum(r.kmMinimo) || "—"} km / {fmtNum(r.toneladasMinimo) || "—"} t
            </div>
            <div className="flex items-center gap-1">
              <Permitido chave="regras-minimo.editar">
                <StatusToggle
                  active={r.ativo}
                  onChange={(next) => update.mutate({ id: r.id, body: { ativo: next } })}
                  size="sm"
                />
                <Link href={`/regras-minimo/${r.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
              </Permitido>
              <ExcluirButton
                perm="regras-minimo.excluir"
                path={PATH}
                id={r.id}
                nomeRecurso="esta regra de mínimo"
              />
            </div>
          </Card>
        )}
      />
    </div>
  );
}
