"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingCard, LoadingInline } from "@/components/loading";
import {
  useCreateResource,
  useDeleteResource,
  useResourceList,
  useUpdateResource,
} from "@/lib/client-api";

type Veiculo = { id: string; placa: string; modelo: string | null; ativo: boolean };
const PATH = "/admin/veiculos";

export default function FrotaPage() {
  const list = useResourceList<Veiculo>(PATH);
  const create = useCreateResource<{ placa: string; modelo?: string }, Veiculo>(PATH, PATH);
  const update = useUpdateResource<{ modelo?: string; ativo?: boolean }, Veiculo>(PATH, PATH);
  const remove = useDeleteResource(PATH, PATH);

  const [editing, setEditing] = useState<Veiculo | "new" | null>(null);
  const [placa, setPlaca] = useState("");
  const [modelo, setModelo] = useState("");

  function openNew() { setEditing("new"); setPlaca(""); setModelo(""); }
  function openEdit(v: Veiculo) { setEditing(v); setPlaca(v.placa); setModelo(v.modelo ?? ""); }
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (editing === "new") {
      await create.mutateAsync({ placa: placa.toUpperCase(), modelo: modelo || undefined });
    } else if (editing) {
      await update.mutateAsync({ id: editing.id, body: { modelo: modelo || undefined } });
    }
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Frota</h1>
          <p className="text-sm text-muted-foreground">Veículos cadastrados.</p>
        </div>
        <Button onClick={openNew} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Novo veículo
        </Button>
      </header>

      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <LoadingCard />
        )}
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
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Placa</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && <TableRow><TableCell colSpan={4}><LoadingInline /></TableCell></TableRow>}
            {list.data?.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono font-medium">{v.placa}</TableCell>
                <TableCell>{v.modelo ?? "—"}</TableCell>
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
              <TableRow><TableCell colSpan={4} className="text-muted-foreground">Nenhum veículo cadastrado.</TableCell></TableRow>
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
              <Input id="placa" required disabled={editing !== "new"}
                placeholder="ABC1D23" maxLength={8}
                value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modelo">Modelo</Label>
              <Input id="modelo" value={modelo} onChange={(e) => setModelo(e.target.value)} />
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
