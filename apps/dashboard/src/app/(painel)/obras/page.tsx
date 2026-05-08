"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingCard, LoadingInline } from "@/components/loading";
import { useCreateResource, useDeleteResource, useResourceList, useUpdateResource } from "@/lib/client-api";

type Empresa = { id: string; nome: string };
type Obra = {
  id: string; nome: string; ativa: boolean;
  empresaCliente: Empresa; empresaClienteId: string;
};
const PATH = "/admin/obras";
const EMPRESAS_PATH = "/admin/empresas";

export default function ObrasPage() {
  const list = useResourceList<Obra>(PATH);
  const empresas = useResourceList<Empresa>(EMPRESAS_PATH);
  const create = useCreateResource<{ nome: string; empresaClienteId: string }, Obra>(PATH, PATH);
  const update = useUpdateResource<Partial<Obra>, Obra>(PATH, PATH);
  const remove = useDeleteResource(PATH, PATH);

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

      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <LoadingCard />
        )}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma obra cadastrada.
          </Card>
        )}
        {list.data?.map((o) => (
          <Card key={o.id} className="space-y-2 p-4">
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
        ))}
      </div>

      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && <TableRow><TableCell colSpan={4}><LoadingInline /></TableCell></TableRow>}
            {list.data?.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.nome}</TableCell>
                <TableCell>{o.empresaCliente.nome}</TableCell>
                <TableCell>
                  <StatusToggle
                    active={o.ativa}
                    onChange={(next) => update.mutate({ id: o.id, body: { ativa: next } })}
                    size="sm"
                    label
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(o)}><Pencil className="h-4 w-4" /></Button>
                  <ExcluirButton
                    path="/admin/obras"
                    id={o.id}
                    nomeRecurso={`a obra "${o.nome}"`}
                  />
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-muted-foreground">Nenhuma obra cadastrada.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

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
