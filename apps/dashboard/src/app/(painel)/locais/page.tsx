"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
import { AddressAutocomplete, type SugestaoEndereco } from "@/components/ui/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadingCard, LoadingInline } from "@/components/loading";
import {
  fetchApi,
  useAuthToken,
  useCreateResource,
  useDeleteResource,
  useResourceList,
  useUpdateResource,
} from "@/lib/client-api";

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";
type Obra = { id: string; nome: string };
type Local = {
  id: string; nome: string; logradouro: string; numero: string | null; bairro: string | null;
  cidade: string; uf: string; cep: string | null; pontoReferencia: string | null;
  tipo: Tipo; obraId: string | null; ativo: boolean; obra: Obra | null;
};
type ViaCepRes = {
  fonte: "VIACEP"; logradouro?: string; bairro?: string; cidade: string; uf: string; cep?: string;
};

const PATH = "/admin/locais";
const OBRAS_PATH = "/admin/obras";

const empty = {
  nome: "", logradouro: "", numero: "", bairro: "", cidade: "", uf: "PR",
  cep: "", pontoReferencia: "", tipo: "AMBOS" as Tipo, obraId: "",
  lat: null as number | null, lng: null as number | null,
};

export default function LocaisPage() {
  const list = useResourceList<Local>(PATH);
  const obras = useResourceList<Obra>(OBRAS_PATH);
  const create = useCreateResource<Record<string, unknown>, Local>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Local>(PATH, PATH);
  const remove = useDeleteResource(PATH, PATH);
  const token = useAuthToken();

  const [editing, setEditing] = useState<Local | "new" | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [cepLoading, setCepLoading] = useState(false);
  const [cepNotFound, setCepNotFound] = useState(false);

  function openNew() { setEditing("new"); setForm({ ...empty }); setCepNotFound(false); }
  function openEdit(l: Local) {
    setEditing(l);
    setForm({
      nome: l.nome, logradouro: l.logradouro, numero: l.numero ?? "",
      bairro: l.bairro ?? "", cidade: l.cidade, uf: l.uf, cep: l.cep ?? "",
      pontoReferencia: l.pontoReferencia ?? "", tipo: l.tipo, obraId: l.obraId ?? "",
      lat: null, lng: null,
    });
    setCepNotFound(false);
  }

  function aplicarSugestao(s: SugestaoEndereco) {
    setForm((f) => ({
      ...f,
      nome: f.nome || s.nome || "",
      logradouro: s.logradouro ?? s.nome ?? f.logradouro,
      numero: s.numero ?? f.numero,
      bairro: s.bairro ?? f.bairro,
      cidade: s.cidade || f.cidade,
      uf: s.uf || f.uf,
      cep: s.cep ?? f.cep,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
    }));
  }

  async function consultarCep(cepRaw: string) {
    const cep = cepRaw.replace(/\D/g, "");
    if (cep.length !== 8 || !token) return;
    setCepLoading(true); setCepNotFound(false);
    try {
      const res = await fetchApi<ViaCepRes | null>(`/geocoding/cep?cep=${cep}`, { token });
      if (res) {
        setForm((f) => ({
          ...f,
          logradouro: res.logradouro ?? f.logradouro,
          bairro: res.bairro ?? f.bairro,
          cidade: res.cidade,
          uf: res.uf,
          cep: res.cep ?? cep,
        }));
      } else {
        setCepNotFound(true);
      }
    } finally {
      setCepLoading(false);
    }
  }

  async function onSave(ev: React.FormEvent) {
    ev.preventDefault();
    const body: Record<string, unknown> = {
      nome: form.nome, logradouro: form.logradouro, cidade: form.cidade, uf: form.uf, tipo: form.tipo,
      numero: form.numero || undefined, bairro: form.bairro || undefined,
      cep: form.cep ? form.cep.replace(/\D/g, "") : undefined,
      pontoReferencia: form.pontoReferencia || undefined,
      obraId: form.obraId || undefined,
      lat: form.lat ?? undefined,
      lng: form.lng ?? undefined,
    };
    if (editing === "new") await create.mutateAsync(body);
    else if (editing) await update.mutateAsync({ id: editing.id, body });
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Locais</h1>
          <p className="text-sm text-muted-foreground">
            Locais de carga e descarga. Busque por nome, endereço ou ponto de interesse.
          </p>
        </div>
        <Button onClick={openNew} className="w-full md:w-auto">
          <Plus className="h-4 w-4" /> Novo local
        </Button>
      </header>

      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <LoadingCard />
        )}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum local cadastrado.
          </Card>
        )}
        {list.data?.map((l) => (
          <Card key={l.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.cidade}/{l.uf}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={l.ativo}
                  onChange={(next) => update.mutate({ id: l.id, body: { ativo: next } })}
                  size="sm"
                  label
                />
                <Button variant="ghost" size="icon" onClick={() => openEdit(l)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <ExcluirButton
                  path="/admin/locais"
                  id={l.id}
                  nomeRecurso={`o local "${l.nome}"`}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {l.logradouro}
              {l.numero ? `, ${l.numero}` : ""}
              {l.bairro ? ` — ${l.bairro}` : ""}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>
                <span className="text-muted-foreground">Tipo: </span>
                {l.tipo}
              </span>
              {l.obra && (
                <span>
                  <span className="text-muted-foreground">Obra: </span>
                  {l.obra.nome}
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
              <TableHead>Endereço</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead>Obra</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && <TableRow><TableCell colSpan={6}><LoadingInline /></TableCell></TableRow>}
            {list.data?.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.nome}</TableCell>
                <TableCell className="text-sm">
                  {l.logradouro}{l.numero ? `, ${l.numero}` : ""}
                  {l.bairro ? ` — ${l.bairro}` : ""}
                </TableCell>
                <TableCell className="text-sm">{l.cidade}/{l.uf}</TableCell>
                <TableCell>{l.obra?.nome ?? "—"}</TableCell>
                <TableCell>{l.tipo}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <StatusToggle
                      active={l.ativo}
                      onChange={(next) => update.mutate({ id: l.id, body: { ativo: next } })}
                      size="sm"
                    />
                    <Button variant="ghost" size="icon" onClick={() => openEdit(l)}><Pencil className="h-4 w-4" /></Button>
                    <ExcluirButton
                      path="/admin/locais"
                      id={l.id}
                      nomeRecurso={`o local "${l.nome}"`}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground">Nenhum local cadastrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={onSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing === "new" ? "Novo local" : "Editar local"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <Label>Nome do local *</Label>
              <Input required placeholder='ex: "Pedreira Souza Naves — balança 2"'
                value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              <p className="text-xs text-muted-foreground">
                Use um nome específico (não só rua) — ajuda na conferência com o motorista.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Buscar endereço</Label>
              <AddressAutocomplete
                value={form.logradouro}
                onChange={(v) => setForm((f) => ({ ...f, logradouro: v }))}
                onSelect={aplicarSugestao}
              />
              <p className="text-xs text-muted-foreground">
                Busque por nome do lugar, rua ou bairro. Os campos abaixo são preenchidos automaticamente.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>CEP</Label>
                <Input value={form.cep} maxLength={9} placeholder="00000-000"
                  onChange={(e) => setForm({ ...form, cep: e.target.value })}
                  onBlur={(e) => consultarCep(e.target.value)} />
                {cepLoading && <p className="text-xs text-muted-foreground">Consultando...</p>}
                {cepNotFound && <p className="text-xs text-amber-600">CEP não encontrado, preencha manual.</p>}
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Logradouro *</Label>
                <Input required value={form.logradouro}
                  onChange={(e) => setForm({ ...form, logradouro: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Número</Label>
                <Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Bairro</Label>
                <Input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label>Cidade *</Label>
                <Input required value={form.cidade}
                  onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>UF *</Label>
                <Input required maxLength={2} value={form.uf}
                  onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Ponto de referência</Label>
              <Input value={form.pontoReferencia}
                onChange={(e) => setForm({ ...form, pontoReferencia: e.target.value })}
                placeholder='ex: "portaria fundos", "balança 2"' />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={form.tipo}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}>
                  <option value="AMBOS">Carga e descarga</option>
                  <option value="CARGA">Apenas carga</option>
                  <option value="DESCARGA">Apenas descarga</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Obra (opcional)</Label>
                <Select value={form.obraId}
                  onChange={(e) => setForm({ ...form, obraId: e.target.value })}>
                  <option value="">— sem obra —</option>
                  {obras.data?.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
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
