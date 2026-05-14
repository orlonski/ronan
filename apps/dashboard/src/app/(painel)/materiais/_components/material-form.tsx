"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";

export type Material = { id: string; nome: string; ativo: boolean };

const PATH = "/admin/materiais";

type Props = { initial?: Material };

export function MaterialForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<{ nome: string }, Material>(PATH, PATH);
  const update = useUpdateResource<{ nome?: string }, Material>(PATH, PATH);
  const [nome, setNome] = useState(initial?.nome ?? "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (initial) {
      await update.mutateAsync({ id: initial.id, body: { nome } });
    } else {
      await create.mutateAsync({ nome });
    }
    router.push("/materiais");
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="max-w-xl p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nome">Nome</Label>
          <Input
            id="nome"
            required
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/materiais">
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
