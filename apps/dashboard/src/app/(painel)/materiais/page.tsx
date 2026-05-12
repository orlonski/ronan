"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterSelect,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useCreateResource, usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Material = { id: string; nome: string; ativo: boolean };

const PATH = "/admin/materiais";

export default function MateriaisPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Material>(PATH, tableState);
  const create = useCreateResource<{ nome: string }, Material>(PATH, PATH);
  const update = useUpdateResource<{ nome?: string; ativo?: boolean }, Material>(PATH, PATH);

  const [editing, setEditing] = useState<Material | "new" | null>(null);
  const [nome, setNome] = useState("");

  function openNew() {
    setEditing("new");
    setNome("");
  }
  function openEdit(m: Material) {
    setEditing(m);
    setNome(m.nome);
  }
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (editing === "new") await create.mutateAsync({ nome });
    else if (editing) await update.mutateAsync({ id: editing.id, body: { nome } });
    setEditing(null);
  }

  const columns = useMemo<ColumnDef<Material>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 128,
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
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Button variant="ghost" size="icon" onClick={() => openEdit(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <ExcluirButton
              path="/admin/materiais"
              id={row.original.id}
              nomeRecurso={`o material "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Materiais</h1>
          <p className="text-sm text-muted-foreground">Tipos de material transportado.</p>
        </div>
        <Button onClick={openNew} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Novo material
        </Button>
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
            searchPlaceholder="Buscar material…"
            filters={
              <ToolbarFilterSelect
                label="Status"
                value={tableState.filters.ativo}
                onChange={(v) => tableState.setFilter("ativo", v)}
                options={[
                  { value: "true", label: "Ativos" },
                  { value: "false", label: "Inativos" },
                ]}
              />
            }
          />
        }
        emptyMessage="Nenhum material cadastrado."
        renderMobileCard={(m) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.nome}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={m.ativo}
                  onChange={(next) => update.mutate({ id: m.id, body: { ativo: next } })}
                  size="sm"
                  label
                />
                <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <ExcluirButton
                  path="/admin/materiais"
                  id={m.id}
                  nomeRecurso={`o material "${m.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <form onSubmit={onSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing === "new" ? "Novo material" : "Editar material"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="nome">Nome</Label>
              <Input id="nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={create.isPending || update.isPending}>
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
