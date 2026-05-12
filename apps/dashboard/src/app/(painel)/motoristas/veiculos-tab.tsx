"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
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

type MotoristaMini = { id: string; nome: string; cpf: string; ativo?: boolean };
type Veiculo = {
  id: string;
  placa: string;
  modelo: string | null;
  ativo: boolean;
  motoristas: MotoristaMini[];
};
const PATH = "/admin/veiculos";
const MOTORISTAS_PATH = "/admin/motoristas";

type FormShape = { placa: string; modelo: string; motoristaIds: string[] };
const empty: FormShape = { placa: "", modelo: "", motoristaIds: [] };

export function VeiculosTab() {
  const list = useResourceList<Veiculo>(PATH);
  const motoristas = useResourceList<MotoristaMini>(MOTORISTAS_PATH);
  const create = useCreateResource<Record<string, unknown>, Veiculo>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Veiculo>(PATH, PATH);

  const [editing, setEditing] = useState<Veiculo | "new" | null>(null);
  const [form, setForm] = useState<FormShape>(empty);

  function openNew() {
    setEditing("new");
    setForm(empty);
  }
  function openEdit(v: Veiculo) {
    setEditing(v);
    setForm({
      placa: v.placa,
      modelo: v.modelo ?? "",
      motoristaIds: v.motoristas.map((m) => m.id),
    });
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (form.motoristaIds.length === 0) {
      alert("Selecione pelo menos 1 motorista pra este veículo.");
      return;
    }
    if (editing === "new") {
      await create.mutateAsync({
        placa: form.placa.toUpperCase(),
        modelo: form.modelo || undefined,
        motoristaIds: form.motoristaIds,
      });
    } else if (editing) {
      await update.mutateAsync({
        id: editing.id,
        body: {
          modelo: form.modelo || undefined,
          motoristaIds: form.motoristaIds,
        },
      });
    }
    setEditing(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Novo veículo
        </Button>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {list.isLoading && <LoadingCard />}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum veículo cadastrado.
          </Card>
        )}
        {list.data?.map((v) => (
          <Card key={v.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-base font-medium">{v.placa}</p>
                <p className="text-xs text-muted-foreground">{v.modelo ?? "Sem modelo"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={v.ativo}
                  onChange={(next) => update.mutate({ id: v.id, body: { ativo: next } })}
                  size="sm"
                  label
                />
                <Button variant="ghost" size="icon" onClick={() => openEdit(v)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <ExcluirButton
                  path="/admin/veiculos"
                  id={v.id}
                  nomeRecurso={`o veículo "${v.placa}"`}
                />
              </div>
            </div>
            {v.motoristas.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {v.motoristas.map((m) => (
                  <span key={m.id} className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {m.nome.split(" ")[0]}
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
              <TableHead>Placa</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Motoristas</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={5}>
                  <LoadingInline />
                </TableCell>
              </TableRow>
            )}
            {list.data?.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono font-medium">{v.placa}</TableCell>
                <TableCell>{v.modelo ?? "—"}</TableCell>
                <TableCell>
                  {v.motoristas.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {v.motoristas.map((m) => (
                        <span
                          key={m.id}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                          title={m.nome}
                        >
                          {m.nome.split(" ")[0]}
                        </span>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <StatusToggle
                    active={v.ativo}
                    onChange={(next) => update.mutate({ id: v.id, body: { ativo: next } })}
                    size="sm"
                    label
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(v)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <ExcluirButton
                    path="/admin/veiculos"
                    id={v.id}
                    nomeRecurso={`o veículo "${v.placa}"`}
                  />
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Nenhum veículo cadastrado.
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
              <DialogTitle>{editing === "new" ? "Novo veículo" : "Editar veículo"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="placa">Placa</Label>
              <Input
                id="placa"
                required
                disabled={editing !== "new"}
                placeholder="ABC1D23"
                maxLength={8}
                value={form.placa}
                onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modelo">Modelo</Label>
              <Input
                id="modelo"
                value={form.modelo}
                onChange={(e) => setForm({ ...form, modelo: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Motoristas vinculados</Label>
              <MultiCheckList
                options={
                  motoristas.data
                    ?.filter((m) => m.ativo !== false)
                    .map((m) => ({
                      value: m.id,
                      primary: m.nome,
                      secondary: m.cpf,
                    })) ?? []
                }
                selectedIds={form.motoristaIds}
                onChange={(next) => setForm({ ...form, motoristaIds: next })}
                emptyLabel="Cadastre motoristas primeiro na aba Motoristas."
                searchPlaceholder="Buscar por nome ou CPF..."
              />
              {form.motoristaIds.length === 0 && (
                <p className="text-xs text-red-600">
                  Selecione pelo menos 1 motorista.
                </p>
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
