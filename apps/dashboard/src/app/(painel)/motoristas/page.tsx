"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { cpfDigits, formatCpf, isCpfValid } from "@ronan/shared-types";
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
import { useCreateResource, useDeleteResource, useResourceList, useUpdateResource } from "@/lib/client-api";

type Veiculo = { id: string; placa: string; modelo: string | null };
type Motorista = {
  id: string; nome: string; cpf: string; telefone: string | null;
  ativo: boolean; veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
};
const PATH = "/admin/motoristas";
const VEICULOS_PATH = "/admin/veiculos";

type FormShape = {
  nome: string; cpf: string; senha: string; telefone: string; veiculoDefaultId: string;
};
const empty: FormShape = { nome: "", cpf: "", senha: "", telefone: "", veiculoDefaultId: "" };

// Aplica máscara 000.000.000-00 enquanto o usuário digita.
function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function MotoristasPage() {
  const list = useResourceList<Motorista>(PATH);
  const veiculos = useResourceList<Veiculo>(VEICULOS_PATH);
  const create = useCreateResource<Record<string, unknown>, Motorista>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Motorista>(PATH, PATH);
  const remove = useDeleteResource(PATH, PATH);

  const [editing, setEditing] = useState<Motorista | "new" | null>(null);
  const [form, setForm] = useState<FormShape>(empty);

  function openNew() { setEditing("new"); setForm(empty); }
  function openEdit(m: Motorista) {
    setEditing(m);
    setForm({
      nome: m.nome, cpf: maskCpf(m.cpf), senha: "",
      telefone: m.telefone ?? "", veiculoDefaultId: m.veiculoDefaultId ?? "",
    });
  }

  async function onSave(ev: React.FormEvent) {
    ev.preventDefault();
    const cpfDigitos = cpfDigits(form.cpf);
    if (!isCpfValid(cpfDigitos)) {
      alert("CPF inválido. Confira os dígitos.");
      return;
    }
    if (editing === "new") {
      await create.mutateAsync({
        nome: form.nome, cpf: cpfDigitos, senha: form.senha,
        telefone: form.telefone || undefined,
        veiculoDefaultId: form.veiculoDefaultId || undefined,
      });
    } else if (editing) {
      const body: Record<string, unknown> = {
        nome: form.nome,
        cpf: cpfDigitos,
        telefone: form.telefone || undefined,
        veiculoDefaultId: form.veiculoDefaultId || null,
      };
      if (form.senha) body.novaSenha = form.senha;
      await update.mutateAsync({ id: editing.id, body });
    }
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Motoristas</h1>
          <p className="text-sm text-muted-foreground">Quem lança viagens no app.</p>
        </div>
        <Button onClick={openNew} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Novo motorista
        </Button>
      </header>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <Card className="p-4 text-sm text-muted-foreground">Carregando...</Card>
        )}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum motorista cadastrado.
          </Card>
        )}
        {list.data?.map((m) => (
          <Card key={m.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.nome}</p>
                <p className="font-mono text-xs text-muted-foreground">{formatCpf(m.cpf)}</p>
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
                  path="/admin/motoristas"
                  id={m.id}
                  nomeRecurso={`o motorista "${m.nome}"`}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {m.telefone && (
                <span>
                  <span className="text-muted-foreground">Tel: </span>
                  {m.telefone}
                </span>
              )}
              {m.veiculoDefault && (
                <span>
                  <span className="text-muted-foreground">Placa: </span>
                  <span className="font-mono">{m.veiculoDefault.placa}</span>
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CPF</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Placa default</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && <TableRow><TableCell colSpan={6}>Carregando...</TableCell></TableRow>}
            {list.data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.nome}</TableCell>
                <TableCell className="font-mono text-xs">{formatCpf(m.cpf)}</TableCell>
                <TableCell>{m.telefone ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{m.veiculoDefault?.placa ?? "—"}</TableCell>
                <TableCell>
                  <StatusToggle
                    active={m.ativo}
                    onChange={(next) => update.mutate({ id: m.id, body: { ativo: next } })}
                    size="sm"
                    label
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>
                  <ExcluirButton
                    path="/admin/motoristas"
                    id={m.id}
                    nomeRecurso={`o motorista "${m.nome}"`}
                  />
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">Nenhum motorista cadastrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <form onSubmit={onSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing === "new" ? "Novo motorista" : "Editar motorista"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Nome</Label>
                <Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>CPF (login)</Label>
                <Input required inputMode="numeric" placeholder="000.000.000-00"
                  value={form.cpf} onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>{editing === "new" ? "Senha" : "Nova senha (opcional)"}</Label>
                <Input type="password" minLength={editing === "new" ? 6 : 0}
                  required={editing === "new"}
                  value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Placa default</Label>
                <Select value={form.veiculoDefaultId}
                  onChange={(e) => setForm({ ...form, veiculoDefaultId: e.target.value })}>
                  <option value="">— sem placa fixa —</option>
                  {veiculos.data?.map((v) => (
                    <option key={v.id} value={v.id}>{v.placa}{v.modelo ? ` · ${v.modelo}` : ""}</option>
                  ))}
                </Select>
              </div>
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
