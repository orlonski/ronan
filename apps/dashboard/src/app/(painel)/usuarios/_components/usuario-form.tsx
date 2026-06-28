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
  whatsappResumo: string | null;
  receberResumoDiario: boolean;
};

type UserBody = {
  nome?: string;
  email?: string;
  senha?: string;
  perfil?: Perfil;
  whatsappResumo?: string;
  receberResumoDiario?: boolean;
};

const PATH = "/admin/users";

type Props = { initial?: User };

export function UsuarioForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<UserBody, User>(PATH, PATH);
  const update = useUpdateResource<UserBody, User>(PATH, PATH);

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    email: initial?.email ?? "",
    senha: "",
    perfil: (initial?.perfil ?? "OPERADOR") as Perfil,
    whatsappResumo: initial?.whatsappResumo ?? "",
    receberResumoDiario: initial?.receberResumoDiario ?? false,
  });

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (initial) {
      const body: UserBody = {
        nome: form.nome,
        perfil: form.perfil,
        whatsappResumo: form.whatsappResumo,
        receberResumoDiario: form.receberResumoDiario,
      };
      if (form.senha) body.senha = form.senha;
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync({
        nome: form.nome,
        email: form.email,
        senha: form.senha,
        perfil: form.perfil,
        whatsappResumo: form.whatsappResumo,
        receberResumoDiario: form.receberResumoDiario,
      });
    }
    router.push("/usuarios");
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

        <div className="space-y-2 rounded-md border p-4">
          <Label>WhatsApp pra resumo diário</Label>
          <Input
            type="tel"
            placeholder="ex: (41) 99999-9999"
            value={form.whatsappResumo}
            onChange={(e) => setForm({ ...form, whatsappResumo: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Número que recebe o resumo. Pode digitar com ou sem DDD/DDI — o sistema
            ajusta. Deixe vazio pra não receber.
          </p>
          <label className="flex cursor-pointer items-center gap-2 pt-1">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={form.receberResumoDiario}
              onChange={(e) =>
                setForm({ ...form, receberResumoDiario: e.target.checked })
              }
            />
            <span className="text-sm">Receber resumo diário (todo dia às 20h)</span>
          </label>
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
