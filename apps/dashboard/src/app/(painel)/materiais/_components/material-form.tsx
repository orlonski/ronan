"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";

export type Material = { id: string; nome: string; ativo: boolean; apelidos: string[] };

const PATH = "/admin/materiais";

type Props = { initial?: Material };

type MaterialBody = { nome: string; apelidos: string[] };

export function MaterialForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<MaterialBody, Material>(PATH, PATH);
  const update = useUpdateResource<Partial<MaterialBody>, Material>(PATH, PATH);
  const [form, setForm] = useState<MaterialBody>({
    nome: initial?.nome ?? "",
    apelidos: initial?.apelidos ?? [],
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (initial) {
      await update.mutateAsync({ id: initial.id, body: form });
    } else {
      await create.mutateAsync(form);
    }
    router.push("/materiais");
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nome">Nome</Label>
          <Input
            id="nome"
            required
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>Apelidos do motorista</Label>
          <TagInput
            value={form.apelidos}
            onChange={(arr) => setForm({ ...form, apelidos: arr })}
            placeholder='ex: "brita", "pedrisco"'
          />
          <p className="text-xs text-muted-foreground">
            Como o motorista chama no WhatsApp/áudio. O agente IA usa pra
            achar o material quando ele escreve diferente do cadastro.
          </p>
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
