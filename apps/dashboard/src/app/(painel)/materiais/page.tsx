"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { StatusToggle } from "@/components/status-toggle";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useCreateResource,
  useDeleteResource,
  useResourceList,
  useUpdateResource,
} from "@/lib/client-api";

type Material = { id: string; nome: string; ativo: boolean };

const PATH = "/admin/materiais";

export default function MateriaisPage() {
  const list = useResourceList<Material>(PATH);
  const create = useCreateResource<{ nome: string }, Material>(PATH, PATH);
  const update = useUpdateResource<{ nome?: string; ativo?: boolean }, Material>(PATH, PATH);
  const remove = useDeleteResource(PATH, PATH);

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

      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <Card className="p-4 text-sm text-muted-foreground">Carregando...</Card>
        )}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum material cadastrado.
          </Card>
        )}
        {list.data?.map((m) => (
          <Card key={m.id} className="space-y-2 p-4">
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
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow><TableCell colSpan={3}>Carregando...</TableCell></TableRow>
            )}
            {list.isError && (
              <TableRow><TableCell colSpan={3} className="text-red-600">Erro ao carregar.</TableCell></TableRow>
            )}
            {list.data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.nome}</TableCell>
                <TableCell>
                  <StatusToggle
                    active={m.ativo}
                    onChange={(next) => update.mutate({ id: m.id, body: { ativo: next } })}
                    size="sm"
                    label
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow><TableCell colSpan={3} className="text-muted-foreground">Nenhum material cadastrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

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
