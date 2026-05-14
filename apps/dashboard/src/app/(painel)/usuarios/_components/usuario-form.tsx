"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";

type Perfil = "ADMIN" | "OPERADOR";
export type User = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  ultimoLoginEm: string | null;
};

const PATH = "/admin/users";

type Props = { initial?: User };

export function UsuarioForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<
    { nome: string; email: string; senha: string; perfil: Perfil },
    User
  >(PATH, PATH);
  const update = useUpdateResource<
    { nome?: string; senha?: string; perfil?: Perfil },
    User
  >(PATH, PATH);

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    email: initial?.email ?? "",
    senha: "",
    perfil: (initial?.perfil ?? "OPERADOR") as Perfil,
  });

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (initial) {
      const body: { nome: string; perfil: Perfil; senha?: string } = {
        nome: form.nome,
        perfil: form.perfil,
      };
      if (form.senha) body.senha = form.senha;
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(form);
    }
    router.push("/usuarios");
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="max-w-xl p-6">
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
          <Label>Email</Label>
          <Input
            type="email"
            required
            disabled={!!initial}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>{initial ? "Nova senha (opcional)" : "Senha"}</Label>
          <Input
            type="password"
            minLength={initial ? 0 : 8}
            required={!initial}
            value={form.senha}
            onChange={(e) => setForm({ ...form, senha: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Perfil</Label>
          <Select
            value={form.perfil}
            onChange={(e) => setForm({ ...form, perfil: e.target.value as Perfil })}
          >
            <option value="OPERADOR">Operador</option>
            <option value="ADMIN">Administrador</option>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/usuarios">
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
