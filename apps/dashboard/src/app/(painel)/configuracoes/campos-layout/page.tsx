"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { StatusToggle } from "@/components/status-toggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Campo = {
  id: string;
  slug: string;
  label: string;
  ordem: number;
  ativo: boolean;
  sistema: boolean;
  tipo: "TEXTO" | "NUMERO" | "DATA";
  descricao: string | null;
};

type FormShape = {
  label: string;
  slug: string;
  tipo: "TEXTO" | "NUMERO" | "DATA";
  descricao: string;
  ordem: number;
};

const PATH = "/admin/campos-layout";

const empty: FormShape = {
  label: "",
  slug: "",
  tipo: "TEXTO",
  descricao: "",
  ordem: 100,
};

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

export default function CamposLayoutPage() {
  const { data: session } = useSession();
  const token = useAuthToken();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: [PATH, token],
    enabled: !!token,
    queryFn: () => fetchApi<Campo[]>(PATH, { token }),
  });

  const create = useMutation({
    mutationFn: (body: Omit<FormShape, "ordem"> & { ordem: number }) =>
      fetchApi<Campo>(PATH, {
        method: "POST",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PATH] }),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Campo> }) =>
      fetchApi<Campo>(`${PATH}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PATH] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      fetchApi<void>(`${PATH}/${id}`, { method: "DELETE", token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PATH] }),
  });

  const [editing, setEditing] = useState<Campo | "new" | null>(null);
  const [form, setForm] = useState<FormShape>(empty);
  const [erro, setErro] = useState<string | null>(null);

  function openNew() {
    setEditing("new");
    setForm(empty);
    setErro(null);
  }
  function openEdit(c: Campo) {
    setEditing(c);
    setForm({
      label: c.label,
      slug: c.slug,
      tipo: c.tipo,
      descricao: c.descricao ?? "",
      ordem: c.ordem,
    });
    setErro(null);
  }

  async function onSave(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    try {
      if (editing === "new") {
        await create.mutateAsync({
          label: form.label,
          slug: form.slug || slugify(form.label),
          tipo: form.tipo,
          descricao: form.descricao || undefined,
          ordem: form.ordem,
        } as never);
      } else if (editing) {
        await update.mutateAsync({
          id: editing.id,
          body: {
            label: form.label,
            ...(editing.sistema ? {} : { slug: form.slug, tipo: form.tipo }),
            descricao: form.descricao || null,
            ordem: form.ordem,
          } as Partial<Campo>,
        });
      }
      setEditing(null);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  if (session?.user?.perfil !== "ADMIN") {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">
          Acesso restrito a administradores.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-6 w-6 text-amber-600" />
            Campos do layout de importação
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Quais campos a IA reconhece quando lê uma planilha de fechamento.
            Adicione campos novos aqui pra que apareçam no dropdown da tela de
            layout de importação. Campos com 🔒 são embarcados (não podem ser
            deletados nem ter slug alterado) — são os usados em match e
            comparação.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo campo
        </Button>
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-24">Ordem</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>Carregando...</TableCell>
              </TableRow>
            )}
            {list.data?.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1">
                    {c.sistema && <Lock className="h-3 w-3 text-muted-foreground" />}
                    {c.label}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                <TableCell className="text-xs">{c.tipo}</TableCell>
                <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                  {c.descricao ?? "—"}
                </TableCell>
                <TableCell className="text-xs">{c.ordem}</TableCell>
                <TableCell>
                  <StatusToggle
                    active={c.ativo}
                    onChange={(next) =>
                      update.mutate({ id: c.id, body: { ativo: next } })
                    }
                    size="sm"
                    label
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!c.sistema && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        if (!confirm(`Deletar campo "${c.label}"?`)) return;
                        try {
                          await remove.mutateAsync(c.id);
                        } catch (err) {
                          alert((err as Error).message);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Nenhum campo cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
      >
        <DialogContent>
          <form onSubmit={onSave} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {editing === "new"
                  ? "Novo campo de layout"
                  : `Editar "${typeof editing === "object" && editing ? editing.label : ""}"`}
              </DialogTitle>
            </DialogHeader>

            {typeof editing === "object" && editing?.sistema && (
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
                <Lock className="mr-1 inline h-3 w-3" />
                Campo de sistema. Slug e tipo travados — só label, descrição e
                ordem podem ser alterados.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-2">
                <Label>Label *</Label>
                <Input
                  required
                  value={form.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setForm((f) => ({
                      ...f,
                      label,
                      // auto-gera slug pra novo (admin pode editar)
                      slug:
                        editing === "new" && !f.slug
                          ? slugify(label)
                          : f.slug,
                    }));
                  }}
                  placeholder='ex: "Número da NF-e"'
                />
              </div>
              <div className="space-y-2">
                <Label>Slug *</Label>
                <Input
                  required
                  value={form.slug}
                  onChange={(e) =>
                    setForm({ ...form, slug: slugify(e.target.value) })
                  }
                  disabled={typeof editing === "object" && editing?.sistema}
                  placeholder="nf_e"
                />
                <p className="text-xs text-muted-foreground">
                  Identificador interno. Lowercase, sem espaços.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onChange={(e) =>
                    setForm({ ...form, tipo: e.target.value as FormShape["tipo"] })
                  }
                  disabled={typeof editing === "object" && editing?.sistema}
                >
                  <option value="TEXTO">Texto</option>
                  <option value="NUMERO">Número</option>
                  <option value="DATA">Data</option>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Descrição</Label>
                <Input
                  value={form.descricao}
                  onChange={(e) =>
                    setForm({ ...form, descricao: e.target.value })
                  }
                  placeholder="O que é esse campo? Aparece pro admin na tela de mapeamento."
                />
              </div>
              <div className="space-y-2">
                <Label>Ordem no dropdown</Label>
                <Input
                  type="number"
                  value={form.ordem}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      ordem: Number(e.target.value) || 100,
                    })
                  }
                />
              </div>
            </div>

            {erro && <p className="text-sm text-destructive">{erro}</p>}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={create.isPending || update.isPending}
              >
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
