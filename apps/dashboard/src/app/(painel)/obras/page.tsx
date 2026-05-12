"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterSelect,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import {
  useCreateResource,
  usePaginatedList,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";

type Empresa = { id: string; nome: string };
type Obra = {
  id: string; nome: string; ativa: boolean;
  empresaCliente: Empresa; empresaClienteId: string;
};
const PATH = "/admin/obras";
const EMPRESAS_PATH = "/admin/empresas";

export default function ObrasPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Obra>(PATH, tableState);
  const empresas = useResourceOptions<Empresa>(EMPRESAS_PATH);
  const create = useCreateResource<{ nome: string; empresaClienteId: string }, Obra>(PATH, PATH);
  const update = useUpdateResource<Partial<Obra>, Obra>(PATH, PATH);

  const [editing, setEditing] = useState<Obra | "new" | null>(null);
  const [form, setForm] = useState({ nome: "", empresaClienteId: "" });

  function openNew() { setEditing("new"); setForm({ nome: "", empresaClienteId: empresas.data?.[0]?.id ?? "" }); }
  function openEdit(o: Obra) { setEditing(o); setForm({ nome: o.nome, empresaClienteId: o.empresaClienteId }); }

  async function onSave(ev: React.FormEvent) {
    ev.preventDefault();
    if (editing === "new") await create.mutateAsync(form);
    else if (editing) await update.mutateAsync({ id: editing.id, body: form });
    setEditing(null);
  }

  const empresaOptions = useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const columns = useMemo<ColumnDef<Obra>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "empresa",
        accessorKey: "empresaCliente.nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Empresa" />,
        cell: ({ row }) => row.original.empresaCliente.nome,
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
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Button variant="ghost" size="icon" onClick={() => openEdit(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <ExcluirButton
              path="/admin/obras"
              id={row.original.id}
              nomeRecurso={`a obra "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Obras</h1>
          <p className="text-sm text-muted-foreground">Locais de obra por empresa-cliente.</p>
        </div>
        <Button onClick={openNew} disabled={!empresas.data?.length} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Nova obra
        </Button>
      </header>

      {empresas.data?.length === 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Cadastre uma empresa-cliente antes de criar obras.
        </p>
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
            searchPlaceholder="Buscar por nome ou empresa…"
            filters={
              <>
                <ToolbarFilterSelect
                  label="Empresa"
                  value={tableState.filters.empresaClienteId}
                  onChange={(v) => tableState.setFilter("empresaClienteId", v)}
                  options={empresaOptions}
                />
                <ToolbarFilterSelect
                  label="Status"
                  value={tableState.filters.ativa}
                  onChange={(v) => tableState.setFilter("ativa", v)}
                  options={[
                    { value: "true", label: "Ativas" },
                    { value: "false", label: "Inativas" },
                  ]}
                />
              </>
            }
          />
        }
        emptyMessage="Nenhuma obra cadastrada."
        renderMobileCard={(o) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{o.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{o.empresaCliente.nome}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={o.ativa}
                  onChange={(next) => update.mutate({ id: o.id, body: { ativa: next } })}
                  size="sm"
                  label
                />
                <Button variant="ghost" size="icon" onClick={() => openEdit(o)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <ExcluirButton
                  path="/admin/obras"
                  id={o.id}
                  nomeRecurso={`a obra "${o.nome}"`}
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
              <DialogTitle>{editing === "new" ? "Nova obra" : "Editar obra"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Empresa-cliente</Label>
              <Select required value={form.empresaClienteId}
                onChange={(e) => setForm({ ...form, empresaClienteId: e.target.value })}>
                {empresas.data?.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit" disabled={create.isPending || update.isPending}>Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
