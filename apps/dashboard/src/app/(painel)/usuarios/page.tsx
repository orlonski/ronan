"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Pencil, Plus } from "lucide-react";
import { StatusToggle } from "@/components/status-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCreateResource, useDeleteResource, useResourceList, useUpdateResource } from "@/lib/client-api";

type Perfil = "ADMIN" | "OPERADOR";
type User = { id: string; nome: string; email: string; perfil: Perfil; ativo: boolean };
const PATH = "/admin/users";

const empty = { nome: "", email: "", senha: "", perfil: "OPERADOR" as Perfil };

export default function UsuariosPage() {
  const { data: session } = useSession();
  const list = useResourceList<User>(PATH);
  const create = useCreateResource<typeof empty, User>(PATH, PATH);
  const update = useUpdateResource<Partial<typeof empty> & { ativo?: boolean }, User>(PATH, PATH);
  const remove = useDeleteResource(PATH, PATH);

  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [form, setForm] = useState({ ...empty });

  if (session?.user?.perfil !== "ADMIN") {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">Acesso restrito a administradores.</p>
      </div>
    );
  }

  function openNew() { setEditing("new"); setForm({ ...empty }); }
  function openEdit(u: User) { setEditing(u); setForm({ nome: u.nome, email: u.email, senha: "", perfil: u.perfil }); }

  async function onSave(ev: React.FormEvent) {
    ev.preventDefault();
    if (editing === "new") await create.mutateAsync(form);
    else if (editing) {
      const body: Partial<typeof empty> = { nome: form.nome, perfil: form.perfil };
      if (form.senha) body.senha = form.senha;
      await update.mutateAsync({ id: editing.id, body });
    }
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">Quem acessa o painel admin.</p>
        </div>
        <Button onClick={openNew} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      </header>

      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <Card className="p-4 text-sm text-muted-foreground">Carregando...</Card>
        )}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum usuário cadastrado.
          </Card>
        )}
        {list.data?.map((u) => (
          <Card key={u.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={u.ativo}
                  onChange={(next) => update.mutate({ id: u.id, body: { ativo: next } })}
                  disabled={u.email === session.user?.email}
                  size="sm"
                  label
                />
                <Button variant="ghost" size="icon" onClick={() => openEdit(u)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>
                <span className="text-muted-foreground">Perfil: </span>
                {u.perfil}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && <TableRow><TableCell colSpan={5}>Carregando...</TableCell></TableRow>}
            {list.data?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.nome}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{u.perfil}</TableCell>
                <TableCell>
                  <StatusToggle
                    active={u.ativo}
                    onChange={(next) => update.mutate({ id: u.id, body: { ativo: next } })}
                    disabled={u.email === session.user?.email}
                    size="sm"
                    label
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <form onSubmit={onSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing === "new" ? "Novo usuário" : "Editar usuário"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" required disabled={editing !== "new"}
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{editing === "new" ? "Senha" : "Nova senha (opcional)"}</Label>
              <Input type="password" minLength={editing === "new" ? 8 : 0}
                required={editing === "new"}
                value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Perfil</Label>
              <Select value={form.perfil} onChange={(e) => setForm({ ...form, perfil: e.target.value as Perfil })}>
                <option value="OPERADOR">Operador</option>
                <option value="ADMIN">Administrador</option>
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
