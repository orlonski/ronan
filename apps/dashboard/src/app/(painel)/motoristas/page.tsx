"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
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
import { Trash2 } from "lucide-react";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterSelect,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useCreateResource, usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Veiculo = { id: string; placa: string; modelo: string | null };
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

type PlacaRow = { placa: string; modelo: string };
type FormShape = {
  nome: string;
  cpf: string;
  senha: string;
  telefone: string;
  email: string;
  placas: PlacaRow[];
  /** Placa string (não id). Backend resolve. */
  placaDefault: string | null;
};
const empty: FormShape = {
  nome: "",
  cpf: "",
  senha: "",
  telefone: "",
  email: "",
  placas: [],
  placaDefault: null,
};

const placaRegex = /^[A-Z]{3}-?\d[A-Z\d]\d{2}$/i;

function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function MotoristasPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Motorista>(PATH, tableState);
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
      placas: m.veiculos.map((v) => ({ placa: v.placa, modelo: v.modelo ?? "" })),
      placaDefault: m.veiculoDefault?.placa ?? null,
    });
  }

  function addPlaca() {
    setForm((f) => ({ ...f, placas: [...f.placas, { placa: "", modelo: "" }] }));
  }
  function removePlaca(idx: number) {
    setForm((f) => {
      const removida = f.placas[idx]?.placa.toUpperCase();
      const novas = f.placas.filter((_, i) => i !== idx);
      const novoDefault =
        removida && f.placaDefault === removida ? null : f.placaDefault;
      return { ...f, placas: novas, placaDefault: novoDefault };
    });
  }
  function updatePlaca(idx: number, key: keyof PlacaRow, value: string) {
    setForm((f) => {
      const novas = f.placas.map((p, i) => (i === idx ? { ...p, [key]: value } : p));
      const original = f.placas[idx];
      let novoDefault = f.placaDefault;
      if (key === "placa" && original && f.placaDefault === original.placa.toUpperCase()) {
        novoDefault = value.toUpperCase();
      }
      return { ...f, placas: novas, placaDefault: novoDefault };
    });
  }
  function setDefault(placa: string) {
    setForm((f) => ({ ...f, placaDefault: placa.toUpperCase() }));
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
    const placasLimpas = form.placas
      .map((p) => ({ placa: p.placa.trim().toUpperCase(), modelo: p.modelo.trim() }))
      .filter((p) => p.placa !== "");
    for (const p of placasLimpas) {
      if (!placaRegex.test(p.placa)) {
        alert(`Placa "${p.placa}" inválida. Use ABC1D23 (Mercosul) ou ABC1234 (antigo).`);
        return;
      }
    }
    const placasSet = new Set(placasLimpas.map((p) => p.placa));
    if (placasSet.size !== placasLimpas.length) {
      alert("Há placas repetidas. Remova duplicadas.");
      return;
    }
    let placaDefault = form.placaDefault;
    if (placaDefault && !placasSet.has(placaDefault)) placaDefault = null;
    if (!placaDefault && placasLimpas.length === 1) {
      placaDefault = placasLimpas[0]!.placa;
    }
    const placasPayload = placasLimpas.map((p) => ({
      placa: p.placa,
      modelo: p.modelo || undefined,
    }));

    if (editing === "new") {
      await create.mutateAsync({
        nome: form.nome,
        cpf: cpfDigitos,
        senha: form.senha,
        telefone: telDigitos || undefined,
        email: emailTrim || undefined,
        placas: placasPayload,
        placaDefault,
      });
    } else if (editing) {
      const body: Record<string, unknown> = {
        nome: form.nome,
        cpf: cpfDigitos,
        telefone: telDigitos || undefined,
        email: emailTrim || undefined,
        placas: placasPayload,
        placaDefault,
      };
      if (form.senha) body.novaSenha = form.senha;
      await update.mutateAsync({ id: editing.id, body });
    }
    setEditing(null);
  }

  const columns = useMemo<ColumnDef<Motorista>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "cpf",
        accessorKey: "cpf",
        header: ({ column }) => <DataTableColumnHeader column={column} title="CPF" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{formatCpf(row.original.cpf)}</span>
        ),
      },
      {
        id: "telefone",
        accessorKey: "telefone",
        enableSorting: false,
        header: "Telefone",
        cell: ({ row }) =>
          row.original.telefone ? formatTelefone(row.original.telefone) : "—",
      },
      {
        id: "email",
        accessorKey: "email",
        enableSorting: false,
        header: "Email",
        cell: ({ row }) => (
          <span className="text-xs">{row.original.email ?? "—"}</span>
        ),
      },
      {
        id: "placas",
        enableSorting: false,
        header: "Placas",
        cell: ({ row }) =>
          row.original.veiculos.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.veiculos.map((v) => (
                <span
                  key={v.id}
                  className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                    v.id === row.original.veiculoDefaultId
                      ? "bg-blue-100 text-blue-700"
                      : "bg-muted text-muted-foreground"
                  }`}
                  title={v.id === row.original.veiculoDefaultId ? "Padrão" : undefined}
                >
                  {v.placa}
                </span>
              ))}
            </div>
          ),
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 96,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusToggle
            active={row.original.ativo}
            onChange={(next) =>
              update.mutate({ id: row.original.id, body: { ativo: next } })
            }
            size="sm"
            label
          />
        ),
      },
      {
        id: "acoes",
        size: 140,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Button variant="ghost" size="icon" onClick={() => openEdit(row.original)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <ConviteWhatsappButton tipo="motorista" id={row.original.id} nome={row.original.nome} />
            <ExcluirButton
              path="/admin/motoristas"
              id={row.original.id}
              nomeRecurso={`o motorista "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Motoristas</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de motoristas e suas placas. Cada motorista pode ter várias placas.
          </p>
        </div>
        <Button onClick={openNew} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Novo motorista
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
            searchPlaceholder="Buscar por nome, CPF, telefone, email…"
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
        emptyMessage="Nenhum motorista encontrado."
        renderMobileCard={(m) => (
          <Card className="space-y-2 p-4">
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
        )}
      />

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Placas</Label>
                <Button type="button" variant="outline" size="sm" onClick={addPlaca}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar placa
                </Button>
              </div>
              {form.placas.length === 0 ? (
                <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                  Nenhuma placa cadastrada. Clique em &quot;Adicionar placa&quot; pra incluir.
                </p>
              ) : (
                <div className="space-y-2">
                  {form.placas.map((p, idx) => {
                    const placaUpper = p.placa.toUpperCase();
                    const ehPadrao =
                      placaUpper !== "" && form.placaDefault === placaUpper;
                    return (
                      <div
                        key={idx}
                        className="flex items-start gap-2 rounded-md border bg-background p-2"
                      >
                        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                          <Input
                            placeholder="ABC1D23"
                            value={p.placa}
                            maxLength={8}
                            onChange={(e) =>
                              updatePlaca(idx, "placa", e.target.value.toUpperCase())
                            }
                            className="font-mono"
                          />
                          <Input
                            placeholder="Modelo (opcional)"
                            value={p.modelo}
                            maxLength={80}
                            onChange={(e) => updatePlaca(idx, "modelo", e.target.value)}
                          />
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {form.placas.length > 1 && placaUpper && (
                            <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                              <input
                                type="radio"
                                name="placa-default"
                                checked={ehPadrao}
                                onChange={() => setDefault(placaUpper)}
                                className="h-3 w-3 accent-blue-600"
                              />
                              padrão
                            </label>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removePlaca(idx)}
                            title="Remover placa"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
