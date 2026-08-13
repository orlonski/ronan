"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TransportadoraComboboxMulti,
  transportadoraOption,
} from "@/components/fk-comboboxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ASSUNTOS_RESUMO, RECURSOS_LABEL } from "@ronan/shared-types";
import { useApiQuery, useCreateResource, useUpdateResource } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

type Papel = { id: string; nome: string; permissoes: string[] };
type PermissaoRow = { chave: string; titulo: string; escopavel?: boolean };
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
  acessoGlobal: boolean;
  transportadoras: { id: string; nome: string }[];
};

type UserBody = {
  nome?: string;
  email?: string;
  senha?: string;
  whatsappResumo?: string;
  receberResumoDiario?: boolean;
  resumoAssuntos?: string[];
  papelId?: string | null;
  acessoGlobal?: boolean;
  transportadoraIds?: string[];
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
  // Catálogo com o marcador `escopavel` (derivado dos endpoints que sabem
  // filtrar por frota) — pra dizer, ANTES de salvar, o que o papel escolhido
  // realmente vai render pra um usuário restrito.
  const catalogo = useApiQuery<PermissaoRow[]>("/admin/permissoes", {
    enabled: podeAtribuirPapel,
  });

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
    // Novo usuário nasce com acesso global — o restrito é a exceção, marcada
    // conscientemente. Mesma trava do papel: só com "permissoes.gerenciar".
    acessoGlobal: initial?.acessoGlobal ?? true,
    transportadoraIds: (initial?.transportadoras ?? []).map((t) => t.id),
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
      if (podeAtribuirPapel) {
        body.papelId = form.papelId || null;
        body.acessoGlobal = form.acessoGlobal;
        if (!form.acessoGlobal) body.transportadoraIds = form.transportadoraIds;
      }
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
      if (podeAtribuirPapel) {
        body.papelId = form.papelId || null;
        body.acessoGlobal = form.acessoGlobal;
        if (!form.acessoGlobal) body.transportadoraIds = form.transportadoraIds;
      }
      await create.mutateAsync(body);
    }
    router.push("/usuarios");
  }

  const saving = create.isPending || update.isPending;

  // Prévia do acesso restrito: das permissões do papel, quais sobrevivem ao
  // escopo. Um papel de uso interno (ex.: Operador) tem dezenas de chaves e
  // quase nenhuma vale pra frota terceira — melhor mostrar isso aqui do que
  // deixar quem configurou descobrir pelo menu vazio do gestor.
  const previaEscopo = useMemo(() => {
    const papel = (papeis.data ?? []).find((p) => p.id === form.papelId);
    const rows = catalogo.data ?? [];
    if (!papel || rows.length === 0) return null;
    const escopaveis = new Set(rows.filter((r) => r.escopavel).map((r) => r.chave));
    const valem = papel.permissoes.filter((c) => escopaveis.has(c));
    const titulo = (c: string) =>
      RECURSOS_LABEL[c.split(".")[0]!] ?? c.split(".")[0]!;
    const telas = [...new Set(valem.filter((c) => c.endsWith(".ver")).map(titulo))];
    return { total: papel.permissoes.length, valem: valem.length, telas, papel: papel.nome };
  }, [papeis.data, catalogo.data, form.papelId]);
  // Restrito sem nenhuma transportadora = usuário que não vê nada. O backend
  // recusa (Zod), mas travar o botão evita o ida-e-volta.
  const escopoIncompleto =
    podeAtribuirPapel && !form.acessoGlobal && form.transportadoraIds.length === 0;

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

        {podeAtribuirPapel && (
          <div className="space-y-3 rounded-md border p-4">
            <Label>Acesso aos dados</Label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                className="mt-1"
                checked={form.acessoGlobal}
                onChange={() => setForm({ ...form, acessoGlobal: true })}
              />
              <span className="text-sm">
                <span className="font-medium">Vê tudo</span>
                <span className="block text-xs text-muted-foreground">
                  Todas as viagens, motoristas e placas — como qualquer usuário da
                  empresa.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                className="mt-1"
                checked={!form.acessoGlobal}
                onChange={() => setForm({ ...form, acessoGlobal: false })}
              />
              <span className="text-sm">
                <span className="font-medium">Restrito a transportadoras</span>
                <span className="block text-xs text-muted-foreground">
                  Só enxerga o que foi lançado pelas frotas escolhidas. Para o gestor
                  de uma transportadora que roda pra gente.
                </span>
              </span>
            </label>

            {!form.acessoGlobal && (
              <div className="space-y-2 border-t pt-3">
                <Label>Transportadoras que ele enxerga</Label>
                <TransportadoraComboboxMulti
                  value={form.transportadoraIds}
                  onChange={(v) => setForm({ ...form, transportadoraIds: v })}
                  initialOptions={(initial?.transportadoras ?? []).map(transportadoraOption)}
                />
                <p className="text-xs text-muted-foreground">
                  Quais telas ele acessa é o papel que decide — o escopo só filtra os
                  dados. As telas marcadas com o selo{" "}
                  <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-medium text-emerald-800">frota</span>{" "}
                  em Papéis e permissões filtram pela transportadora dele; as demais
                  mostram a operação inteira, então libere no papel só o que quiser
                  que ele veja.
                </p>
                {form.transportadoraIds.length === 0 && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-500">
                    Escolha pelo menos uma — sem nenhuma, ele não enxerga nada.
                  </p>
                )}

                {previaEscopo && (
                  <div className="rounded-md border bg-muted/40 p-3 text-xs">
                    <p className="font-medium">
                      Com o papel {previaEscopo.papel}, filtram pela frota dele:{" "}
                      {previaEscopo.telas.length === 0
                        ? "nenhuma tela"
                        : previaEscopo.telas.join(", ")}
                      .
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {previaEscopo.valem} de {previaEscopo.total} permissões do papel
                      filtram pela transportadora
                      {previaEscopo.valem < previaEscopo.total && (
                        <>
                          {" "}— nas outras {previaEscopo.total - previaEscopo.valem} ele
                          enxerga a operação inteira (fechamentos, clientes, locais…)
                        </>
                      )}
                      .
                    </p>
                    {previaEscopo.valem < previaEscopo.total && (
                      <p className="mt-1 text-amber-700 dark:text-amber-500">
                        Reaproveitar papel de uso interno costuma liberar mais do que se
                        quer. Para um gestor de frota, vale um papel só dele.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
          <Button type="submit" disabled={saving || escopoIncompleto}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
