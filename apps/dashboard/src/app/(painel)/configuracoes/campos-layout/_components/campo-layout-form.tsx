"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";

export type Campo = {
  id: string;
  slug: string;
  label: string;
  ordem: number;
  ativo: boolean;
  sistema: boolean;
  tipo: "TEXTO" | "NUMERO" | "DATA";
  descricao: string | null;
};

const PATH = "/admin/campos-layout";

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

type FormShape = {
  label: string;
  slug: string;
  tipo: "TEXTO" | "NUMERO" | "DATA";
  descricao: string;
  ordem: number;
};

type Props = { initial?: Campo };

export function CampoLayoutForm({ initial }: Props) {
  const router = useRouter();
  const token = useAuthToken();
  const qc = useQueryClient();

  const create = useMutation({
    mutationFn: (body: FormShape) =>
      fetchApi<Campo>(PATH, { method: "POST", body: JSON.stringify(body), token }),
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

  const [form, setForm] = useState<FormShape>({
    label: initial?.label ?? "",
    slug: initial?.slug ?? "",
    tipo: initial?.tipo ?? "TEXTO",
    descricao: initial?.descricao ?? "",
    ordem: initial?.ordem ?? 100,
  });
  const [erro, setErro] = useState<string | null>(null);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          body: {
            label: form.label,
            ...(initial.sistema ? {} : { slug: form.slug, tipo: form.tipo }),
            descricao: form.descricao || null,
            ordem: form.ordem,
          } as Partial<Campo>,
        });
      } else {
        await create.mutateAsync({
          label: form.label,
          slug: form.slug || slugify(form.label),
          tipo: form.tipo,
          descricao: form.descricao,
          ordem: form.ordem,
        });
      }
      router.push("/configuracoes/campos-layout");
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="max-w-2xl p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        {initial?.sistema && (
          <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
            <Lock className="mr-1 inline h-3 w-3" />
            Campo de sistema. Slug e tipo travados — só label, descrição e ordem podem ser alterados.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Label *</Label>
            <Input
              required
              autoFocus
              value={form.label}
              onChange={(e) => {
                const label = e.target.value;
                setForm((f) => ({
                  ...f,
                  label,
                  slug: !initial && !f.slug ? slugify(label) : f.slug,
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
              onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
              disabled={!!initial?.sistema}
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
              disabled={!!initial?.sistema}
            >
              <option value="TEXTO">Texto</option>
              <option value="NUMERO">Número</option>
              <option value="DATA">Data</option>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Descrição</Label>
            <Input
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="O que é esse campo? Aparece pro admin na tela de mapeamento."
            />
          </div>
          <div className="space-y-2">
            <Label>Ordem no dropdown</Label>
            <Input
              type="number"
              value={form.ordem}
              onChange={(e) =>
                setForm({ ...form, ordem: Number(e.target.value) || 100 })
              }
            />
          </div>
        </div>

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/configuracoes/campos-layout">
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </Link>
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
