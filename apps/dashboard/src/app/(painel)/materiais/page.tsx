"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Materiais</h1>
          <p className="text-sm text-muted-foreground">Tipos de material transportado.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo material
        </Button>
      </header>

      <Card>
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
                  <span className={m.ativo ? "text-green-700" : "text-muted-foreground"}>
                    {m.ativo ? "ativo" : "inativo"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(m)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {m.ativo && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => confirm(`Inativar "${m.nome}"?`) && remove.mutate(m.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
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
