"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ASSUNTOS_RESUMO } from "@ronan/shared-types";
import { useApiQuery, useCreateResource, useUpdateResource } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Papel = { id: string; nome: string };
export type User = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  ultimoLoginEm: string | null;
  whatsappResumo: string | null;
  receberResumoDiario: boolean;
  resumoAssuntos: string[];
  papelId: string | null;
  papel: { id: string; nome: string } | null;
};

type UserBody = {
  nome?: string;
  email?: string;
  senha?: string;
  whatsappResumo?: string;
  receberResumoDiario?: boolean;
  resumoAssuntos?: string[];
  papelId?: string | null;
};

const PATH = "/admin/users";

type Props = { initial?: User };

export function UsuarioForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<UserBody, User>(PATH, PATH);
  const update = useUpdateResource<UserBody, User>(PATH, PATH);
  const { temPermissao } = usePermissoes();
  // Atribuir papel é RBAC (pode dar acesso total via Administrador) — exige
  // "permissoes.gerenciar", não só "usuarios.editar". Espelha o guard do backend.
  const podeAtribuirPapel = temPermissao("permissoes.gerenciar");
  // GET /admin/papeis também exige "permissoes.gerenciar" — nem tenta buscar
  // sem a permissão.
  const papeis = useApiQuery<Papel[]>("/admin/papeis", { enabled: podeAtribuirPapel });

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    email: initial?.email ?? "",
    senha: "",
    whatsappResumo: initial?.whatsappResumo ?? "",
    receberResumoDiario: initial?.receberResumoDiario ?? false,
    // Novo usuário começa com todos os assuntos marcados.
    resumoAssuntos: new Set<string>(
      initial?.resumoAssuntos ?? ASSUNTOS_RESUMO.map((a) => a.id),
    ),
    papelId: initial?.papelId ?? "",
  });

  function toggleAssunto(id: string) {
    setForm((f) => {
      const s = new Set(f.resumoAssuntos);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return { ...f, resumoAssuntos: s };
    });
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (initial) {
      const body: UserBody = {
        nome: form.nome,
        whatsappResumo: form.whatsappResumo,
        receberResumoDiario: form.receberResumoDiario,
        resumoAssuntos: [...form.resumoAssuntos],
      };
      // Só manda papelId se o campo estiver habilitado — quem não pode gerenciar
      // permissões não deve nem tentar (o backend também recusa).
      if (podeAtribuirPapel) body.papelId = form.papelId || null;
      if (form.senha) body.senha = form.senha;
      await update.mutateAsync({ id: initial.id, body });
    } else {
      const body: UserBody = {
        nome: form.nome,
        email: form.email,
        senha: form.senha,
        whatsappResumo: form.whatsappResumo,
        receberResumoDiario: form.receberResumoDiario,
        resumoAssuntos: [...form.resumoAssuntos],
      };
      if (podeAtribuirPapel) body.papelId = form.papelId || null;
      await create.mutateAsync(body);
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
          <Label>Papel (permissões)</Label>
          {podeAtribuirPapel ? (
            <>
              <Select
                value={form.papelId}
                onChange={(e) => setForm({ ...form, papelId: e.target.value })}
              >
                <option value="">— Sem papel —</option>
                {(papeis.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Define quais telas o usuário acessa. Configure os papéis em Papéis e
                permissões.
              </p>
            </>
          ) : (
            <>
              <Input disabled value={initial?.papel?.nome ?? "— Sem papel —"} />
              <p className="text-xs text-muted-foreground">
                Só quem tem a permissão &quot;Papéis e permissões &gt; Gerenciar&quot;
                pode alterar o papel de um usuário.
              </p>
            </>
          )}
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <Label>Resumo diário no WhatsApp</Label>
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
          <label className="flex cursor-pointer items-center gap-2">
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

          <div className="space-y-1 pt-1">
            <p className="text-xs font-medium text-muted-foreground">
              Assuntos que este usuário recebe
            </p>
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {ASSUNTOS_RESUMO.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={form.resumoAssuntos.has(a.id)}
                    onChange={() => toggleAssunto(a.id)}
                  />
                  <span>{a.titulo}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Cada usuário escolhe o que recebe — independente do papel de acesso.
            </p>
          </div>
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
