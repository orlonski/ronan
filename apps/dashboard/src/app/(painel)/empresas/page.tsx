"use client";

import { useState } from "react";
import { FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
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

type Papel = "RECEBE_PLANILHA" | "MANDA_FECHAMENTO" | "AMBOS";
type Empresa = {
  id: string; nome: string; cnpj: string | null; contato: string | null;
  papel: Papel; ativa: boolean;
};
const PATH = "/admin/empresas";

const PAPEL_LABEL: Record<Papel, string> = {
  RECEBE_PLANILHA: "Recebe planilha",
  MANDA_FECHAMENTO: "Manda fechamento",
  AMBOS: "Ambos",
};

export default function EmpresasPage() {
  const list = useResourceList<Empresa>(PATH);
  const create = useCreateResource<Partial<Empresa>, Empresa>(PATH, PATH);
  const update = useUpdateResource<Partial<Empresa>, Empresa>(PATH, PATH);
  const remove = useDeleteResource(PATH, PATH);

  const [editing, setEditing] = useState<Empresa | "new" | null>(null);
  const [form, setForm] = useState({ nome: "", cnpj: "", contato: "", papel: "AMBOS" as Papel });

  function openNew() { setEditing("new"); setForm({ nome: "", cnpj: "", contato: "", papel: "AMBOS" }); }
  function openEdit(e: Empresa) {
    setEditing(e);
    setForm({ nome: e.nome, cnpj: e.cnpj ?? "", contato: e.contato ?? "", papel: e.papel });
  }

  async function onSave(ev: React.FormEvent) {
    ev.preventDefault();
    const body: Partial<Empresa> = {
      nome: form.nome,
      cnpj: form.cnpj.replace(/\D/g, "") || undefined,
      contato: form.contato || undefined,
      papel: form.papel,
    };
    if (editing === "new") await create.mutateAsync(body);
    else if (editing) await update.mutateAsync({ id: editing.id, body });
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas-cliente</h1>
          <p className="text-sm text-muted-foreground">Empresas pra quem prestamos serviço.</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4" /> Nova empresa</Button>
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && <TableRow><TableCell colSpan={5}>Carregando...</TableCell></TableRow>}
            {list.data?.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.nome}</TableCell>
                <TableCell className="font-mono text-xs">{e.cnpj ?? "—"}</TableCell>
                <TableCell>{PAPEL_LABEL[e.papel]}</TableCell>
                <TableCell>
                  <span className={e.ativa ? "text-green-700" : "text-muted-foreground"}>
                    {e.ativa ? "ativa" : "inativa"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/empresas/${e.id}/layout-envio`} title="Layout de envio">
                    <Button variant="ghost" size="icon">
                      <FileSpreadsheet className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(e)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                  {e.ativa && (
                    <Button variant="ghost" size="icon"
                      onClick={() => confirm(`Inativar ${e.nome}?`) && remove.mutate(e.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nenhuma empresa cadastrada.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <form onSubmit={onSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing === "new" ? "Nova empresa" : "Editar empresa"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>CNPJ</Label>
                <Input value={form.cnpj} maxLength={18}
                  onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  placeholder="apenas números" />
              </div>
              <div className="space-y-2">
                <Label>Papel</Label>
                <Select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value as Papel })}>
                  <option value="AMBOS">Ambos</option>
                  <option value="RECEBE_PLANILHA">Recebe planilha</option>
                  <option value="MANDA_FECHAMENTO">Manda fechamento</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Contato</Label>
              <Input value={form.contato} onChange={(e) => setForm({ ...form, contato: e.target.value })} />
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
