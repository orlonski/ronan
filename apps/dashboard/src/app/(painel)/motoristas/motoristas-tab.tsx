"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  cpfDigits,
  formatCpf,
  formatTelefone,
  isCpfValid,
  isTelefoneValid,
  maskTelefone,
  telefoneDigits,
} from "@ronan/shared-types";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
import { ConviteWhatsappButton } from "@/components/convite-whatsapp-button";
import { MultiCheckList } from "@/components/multi-check-list";
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
import { LoadingCard, LoadingInline } from "@/components/loading";
import { useCreateResource, useResourceList, useUpdateResource } from "@/lib/client-api";

type Veiculo = { id: string; placa: string; modelo: string | null; ativo?: boolean };
type Motorista = {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  email: string | null;
  ativo: boolean;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
  veiculos: Veiculo[];
};
const PATH = "/admin/motoristas";
const VEICULOS_PATH = "/admin/veiculos";

type FormShape = {
  nome: string;
  cpf: string;
  senha: string;
  telefone: string;
  email: string;
  veiculoIds: string[];
  veiculoDefaultId: string | null;
};
const empty: FormShape = {
  nome: "",
  cpf: "",
  senha: "",
  telefone: "",
  email: "",
  veiculoIds: [],
  veiculoDefaultId: null,
};

function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function MotoristasTab() {
  const list = useResourceList<Motorista>(PATH);
  const veiculos = useResourceList<Veiculo>(VEICULOS_PATH);
  const create = useCreateResource<Record<string, unknown>, Motorista>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Motorista>(PATH, PATH);

  const [editing, setEditing] = useState<Motorista | "new" | null>(null);
  const [form, setForm] = useState<FormShape>(empty);

  function openNew() {
    setEditing("new");
    setForm(empty);
  }
  function openEdit(m: Motorista) {
    setEditing(m);
    setForm({
      nome: m.nome,
      cpf: maskCpf(m.cpf),
      senha: "",
      telefone: maskTelefone(m.telefone ?? ""),
      email: m.email ?? "",
      veiculoIds: m.veiculos.map((v) => v.id),
      veiculoDefaultId: m.veiculoDefaultId,
    });
  }

  async function onSave(ev: React.FormEvent) {
    ev.preventDefault();
    const cpfDigitos = cpfDigits(form.cpf);
    if (!isCpfValid(cpfDigitos)) {
      alert("CPF inválido. Confira os dígitos.");
      return;
    }
    const telDigitos = telefoneDigits(form.telefone);
    if (telDigitos && !isTelefoneValid(telDigitos)) {
      alert("Telefone deve ter 10 ou 11 dígitos (com DDD).");
      return;
    }
    const emailTrim = form.email.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      alert("Email inválido.");
      return;
    }
    // Default precisa estar no conjunto de placas
    let veiculoDefaultId = form.veiculoDefaultId;
    if (veiculoDefaultId && !form.veiculoIds.includes(veiculoDefaultId)) {
      veiculoDefaultId = null;
    }
    // Se só tem 1 placa, ela é a padrão
    if (!veiculoDefaultId && form.veiculoIds.length === 1) {
      veiculoDefaultId = form.veiculoIds[0] ?? null;
    }
    if (editing === "new") {
      await create.mutateAsync({
        nome: form.nome,
        cpf: cpfDigitos,
        senha: form.senha,
        telefone: telDigitos || undefined,
        email: emailTrim || undefined,
        veiculoIds: form.veiculoIds,
        veiculoDefaultId,
      });
    } else if (editing) {
      const body: Record<string, unknown> = {
        nome: form.nome,
        cpf: cpfDigitos,
        telefone: telDigitos || undefined,
        email: emailTrim || undefined,
        veiculoIds: form.veiculoIds,
        veiculoDefaultId,
      };
      if (form.senha) body.novaSenha = form.senha;
      await update.mutateAsync({ id: editing.id, body });
    }
    setEditing(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Novo motorista
        </Button>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {list.isLoading && <LoadingCard />}
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
                <ConviteWhatsappButton tipo="motorista" id={m.id} nome={m.nome} />
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
                  {formatTelefone(m.telefone)}
                </span>
              )}
              {m.email && (
                <span>
                  <span className="text-muted-foreground">Email: </span>
                  {m.email}
                </span>
              )}
            </div>
            {m.veiculos.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {m.veiculos.map((v) => (
                  <span
                    key={v.id}
                    className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                      v.id === m.veiculoDefaultId
                        ? "bg-blue-100 text-blue-700"
                        : "bg-muted text-muted-foreground"
                    }`}
                    title={v.id === m.veiculoDefaultId ? "Padrão" : undefined}
                  >
                    {v.placa}
                  </span>
                ))}
              </div>
            )}
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
              <TableHead>Email</TableHead>
              <TableHead>Placas</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <LoadingInline />
                </TableCell>
              </TableRow>
            )}
            {list.data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.nome}</TableCell>
                <TableCell className="font-mono text-xs">{formatCpf(m.cpf)}</TableCell>
                <TableCell>{m.telefone ? formatTelefone(m.telefone) : "—"}</TableCell>
                <TableCell className="text-xs">{m.email ?? "—"}</TableCell>
                <TableCell>
                  {m.veiculos.length === 0 && <span className="text-muted-foreground">—</span>}
                  <div className="flex flex-wrap gap-1">
                    {m.veiculos.map((v) => (
                      <span
                        key={v.id}
                        className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                          v.id === m.veiculoDefaultId
                            ? "bg-blue-100 text-blue-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                        title={v.id === m.veiculoDefaultId ? "Padrão" : undefined}
                      >
                        {v.placa}
                      </span>
                    ))}
                  </div>
                </TableCell>
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
                  <ConviteWhatsappButton tipo="motorista" id={m.id} nome={m.nome} />
                  <ExcluirButton
                    path="/admin/motoristas"
                    id={m.id}
                    nomeRecurso={`o motorista "${m.nome}"`}
                  />
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Nenhum motorista cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <form onSubmit={onSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {editing === "new" ? "Novo motorista" : "Editar motorista"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Nome</Label>
                <Input
                  required
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>CPF (login)</Label>
                <Input
                  required
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  value={form.cpf}
                  onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>{editing === "new" ? "Senha" : "Nova senha (opcional)"}</Label>
                <Input
                  type="password"
                  minLength={editing === "new" ? 6 : 0}
                  required={editing === "new"}
                  value={form.senha}
                  onChange={(e) => setForm({ ...form, senha: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  inputMode="tel"
                  placeholder="(00) 00000-0000"
                  value={form.telefone}
                  onChange={(e) => setForm({ ...form, telefone: maskTelefone(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="motorista@email.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Placas</Label>
                <MultiCheckList
                  options={
                    veiculos.data
                      ?.filter((v) => v.ativo !== false)
                      .map((v) => ({
                        value: v.id,
                        primary: v.placa,
                        secondary: v.modelo ?? undefined,
                      })) ?? []
                  }
                  selectedIds={form.veiculoIds}
                  onChange={(next) => setForm({ ...form, veiculoIds: next })}
                  defaultValue={form.veiculoDefaultId}
                  onDefaultChange={(next) => setForm({ ...form, veiculoDefaultId: next })}
                  emptyLabel="Cadastre veículos primeiro na aba Veículos."
                  searchPlaceholder="Buscar por placa ou modelo..."
                />
              </div>
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
