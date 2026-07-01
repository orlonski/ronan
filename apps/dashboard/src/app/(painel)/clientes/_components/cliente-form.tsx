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
export type Cliente = {
  id: string;
  nome: string;
  ativa: boolean;
  empresa: Empresa;
  empresaId: string;
  apelidos: string[];
};

const PATH = "/admin/clientes";
const EMPRESAS_PATH = "/admin/empresas";

type Props = { initial?: Cliente };

type ClienteBody = {
  nome: string;
  empresaId: string;
  apelidos: string[];
};

export function ClienteForm({ initial }: Props) {
  const router = useRouter();
  const empresas = useResourceOptions<Empresa>(EMPRESAS_PATH);
  const create = useCreateResource<ClienteBody, Cliente>(PATH, PATH);
  const update = useUpdateResource<Partial<ClienteBody>, Cliente>(PATH, PATH);

  const [form, setForm] = useState<ClienteBody>({
    nome: initial?.nome ?? "",
    empresaId: initial?.empresaId ?? "",
    apelidos: initial?.apelidos ?? [],
  });

  useEffect(() => {
    if (initial || form.empresaId || !empresas.data?.[0]?.id) return;
    setForm((f) => ({ ...f, empresaId: empresas.data![0]!.id }));
  }, [initial, form.empresaId, empresas.data]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const body: ClienteBody = {
      nome: form.nome,
      empresaId: form.empresaId,
      apelidos: form.apelidos,
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(body);
    }
    router.push("/clientes");
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
          <Label>Empresa</Label>
          <Select
            required
            value={form.empresaId}
            onChange={(e) => setForm({ ...form, empresaId: e.target.value })}
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
            placeholder='ex: "cliente do beto", "shopping novo"'
          />
          <p className="text-xs text-muted-foreground">
            Como o motorista chama no WhatsApp/áudio. O agente IA usa pra
            achar o cliente quando ele escreve diferente do cadastro.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/clientes">
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
