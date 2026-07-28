"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";

export type Transportadora = {
  id: string;
  nome: string;
  cnpj: string | null;
  contato: string | null;
  ativa: boolean;
};

const PATH = "/admin/transportadoras";

type Props = { initial?: Transportadora };

export function TransportadoraForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<Partial<Transportadora>, Transportadora>(PATH, PATH);
  const update = useUpdateResource<Partial<Transportadora>, Transportadora>(PATH, PATH);

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    cnpj: initial?.cnpj ?? "",
    contato: initial?.contato ?? "",
  });

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const body: Partial<Transportadora> = {
      nome: form.nome,
      cnpj: form.cnpj.replace(/\D/g, "") || undefined,
      contato: form.contato || undefined,
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(body);
    }
    router.push("/transportadoras");
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input
            required
            autoFocus
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="Ex.: Transportes Silva"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>CNPJ</Label>
            <Input
              value={form.cnpj}
              maxLength={18}
              onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
              placeholder="apenas números"
            />
          </div>
          <div className="space-y-2">
            <Label>Contato</Label>
            <Input
              value={form.contato}
              onChange={(e) => setForm({ ...form, contato: e.target.value })}
              placeholder="Quem responde pela frota"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/transportadoras">
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
