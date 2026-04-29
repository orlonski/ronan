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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Frota</h1>
          <p className="text-sm text-muted-foreground">Veículos cadastrados.</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4" /> Novo veículo</Button>
      </header>

      <Card>
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
            {list.isLoading && <TableRow><TableCell colSpan={4}>Carregando...</TableCell></TableRow>}
            {list.data?.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono font-medium">{v.placa}</TableCell>
                <TableCell>{v.modelo ?? "—"}</TableCell>
                <TableCell>
                  <span className={v.ativo ? "text-green-700" : "text-muted-foreground"}>
                    {v.ativo ? "ativo" : "inativo"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(v)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {v.ativo && (
                    <Button variant="ghost" size="icon"
                      onClick={() => confirm(`Inativar ${v.placa}?`) && remove.mutate(v.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
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
