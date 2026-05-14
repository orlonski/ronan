"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TagInput } from "@/components/ui/tag-input";
import {
  useCreateResource,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";

type Empresa = { id: string; nome: string };
export type Obra = {
  id: string;
  nome: string;
  ativa: boolean;
  empresaCliente: Empresa;
  empresaClienteId: string;
  apelidos: string[];
};

const PATH = "/admin/obras";
const EMPRESAS_PATH = "/admin/empresas";

type Props = { initial?: Obra };

type ObraBody = { nome: string; empresaClienteId: string; apelidos: string[] };

export function ObraForm({ initial }: Props) {
  const router = useRouter();
  const empresas = useResourceOptions<Empresa>(EMPRESAS_PATH);
  const create = useCreateResource<ObraBody, Obra>(PATH, PATH);
  const update = useUpdateResource<Partial<ObraBody>, Obra>(PATH, PATH);

  const [form, setForm] = useState<ObraBody>({
    nome: initial?.nome ?? "",
    empresaClienteId: initial?.empresaClienteId ?? "",
    apelidos: initial?.apelidos ?? [],
  });

  useEffect(() => {
    if (initial || form.empresaClienteId || !empresas.data?.[0]?.id) return;
    setForm((f) => ({ ...f, empresaClienteId: empresas.data![0]!.id }));
  }, [initial, form.empresaClienteId, empresas.data]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (initial) {
      await update.mutateAsync({ id: initial.id, body: form });
    } else {
      await create.mutateAsync(form);
    }
    router.push("/obras");
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
          />
        </div>
        <div className="space-y-2">
          <Label>Empresa-cliente</Label>
          <Select
            required
            value={form.empresaClienteId}
            onChange={(e) => setForm({ ...form, empresaClienteId: e.target.value })}
          >
            {empresas.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Apelidos do motorista</Label>
          <TagInput
            value={form.apelidos}
            onChange={(arr) => setForm({ ...form, apelidos: arr })}
            placeholder='ex: "obra do beto", "shopping novo"'
          />
          <p className="text-xs text-muted-foreground">
            Como o motorista chama no WhatsApp/áudio. O agente IA usa pra
            achar a obra quando ele escreve diferente do cadastro.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/obras">
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
