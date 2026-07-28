"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, ShieldCheck, Trash2, Users2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RECURSOS_LABEL } from "@ronan/shared-types";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { RequerTela } from "@/components/requer-tela";
import { cn } from "@/lib/utils";

type PermissaoRow = {
  chave: string;
  modulo: string;
  titulo: string;
  descricao: string | null;
  /**
   * A chave vale pra usuário RESTRITO a transportadora? Vem do backend, que
   * deriva dos endpoints preparados pra filtrar por frota. Marcar uma chave
   * não-escopável num papel de gestor de frota não libera a tela pra ele.
   */
  escopavel?: boolean;
};
type Papel = {
  id: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
  sistema: boolean;
  usuarios: number;
};

const PATH_PAPEIS = "/admin/papeis";
const PATH_PERM = "/admin/permissoes";

// Agrupa as permissões de um módulo por recurso (parte antes do "."), mantendo
// a ordem de chegada. Cada linha da matriz é um recurso com suas ações.
function agruparPorRecurso(itens: PermissaoRow[]): [string, PermissaoRow[]][] {
  const map = new Map<string, PermissaoRow[]>();
  for (const it of itens) {
    const recurso = it.chave.split(".")[0] ?? it.chave;
    const arr = map.get(recurso) ?? [];
    arr.push(it);
    map.set(recurso, arr);
  }
  return [...map.entries()];
}

export default function PermissoesPage() {
  return (
    <RequerTela chave="permissoes.gerenciar">
      <PermissoesInner />
    </RequerTela>
  );
}

function PermissoesInner() {
  const token = useAuthToken();
  const qc = useQueryClient();

  const catalogo = useQuery({
    queryKey: [PATH_PERM],
    enabled: !!token,
    queryFn: () => fetchApi<PermissaoRow[]>(PATH_PERM, { token }),
  });
  const papeis = useQuery({
    queryKey: [PATH_PAPEIS],
    enabled: !!token,
    queryFn: () => fetchApi<Papel[]>(PATH_PAPEIS, { token }),
  });

  const [selId, setSelId] = useState<string | null>(null);
  const [form, setForm] = useState<{ nome: string; descricao: string; permissoes: Set<string> }>({
    nome: "",
    descricao: "",
    permissoes: new Set(),
  });

  const selecionado = papeis.data?.find((p) => p.id === selId) ?? null;
  const ehNovo = selId === null;
  const ehAdministrador = selecionado?.nome === "Administrador";
  const bloqueado = ehAdministrador; // super-papel não editável

  // Seleciona o primeiro papel ao carregar.
  useEffect(() => {
    if (selId === null && papeis.data && papeis.data.length > 0 && form.nome === "") {
      escolher(papeis.data[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papeis.data]);

  function escolher(p: Papel) {
    setSelId(p.id);
    setForm({ nome: p.nome, descricao: p.descricao ?? "", permissoes: new Set(p.permissoes) });
  }

  function novo() {
    setSelId(null);
    setForm({ nome: "", descricao: "", permissoes: new Set() });
  }

  function toggle(chave: string) {
    setForm((f) => {
      const s = new Set(f.permissoes);
      if (s.has(chave)) s.delete(chave);
      else s.add(chave);
      return { ...f, permissoes: s };
    });
  }

  // Catálogo agrupado por módulo, preservando a ordem do backend.
  const grupos = useMemo(() => {
    const map = new Map<string, PermissaoRow[]>();
    for (const p of catalogo.data ?? []) {
      const arr = map.get(p.modulo) ?? [];
      arr.push(p);
      map.set(p.modulo, arr);
    }
    return [...map.entries()];
  }, [catalogo.data]);

  function toggleGrupo(itens: PermissaoRow[], marcar: boolean) {
    setForm((f) => {
      const s = new Set(f.permissoes);
      for (const it of itens) {
        if (marcar) s.add(it.chave);
        else s.delete(it.chave);
      }
      return { ...f, permissoes: s };
    });
  }

  const salvar = useMutation({
    mutationFn: () => {
      const body = {
        nome: form.nome.trim(),
        descricao: form.descricao.trim() || undefined,
        permissoes: [...form.permissoes],
      };
      return ehNovo
        ? fetchApi<Papel>(PATH_PAPEIS, { method: "POST", body: JSON.stringify(body), token })
        : fetchApi<Papel>(`${PATH_PAPEIS}/${selId}`, {
            method: "PATCH",
            body: JSON.stringify(body),
            token,
          });
    },
    onSuccess: (p) => {
      toast.success("Papel salvo.");
      void qc.invalidateQueries({ queryKey: [PATH_PAPEIS] });
      setSelId(p.id);
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  const excluir = useMutation({
    mutationFn: () => fetchApi<void>(`${PATH_PAPEIS}/${selId}`, { method: "DELETE", token }),
    onSuccess: () => {
      toast.success("Papel excluído.");
      void qc.invalidateQueries({ queryKey: [PATH_PAPEIS] });
      novo();
    },
    onError: (e: Error) => toast.error("Não foi possível excluir", { description: e.message }),
  });

  const nomeInvalido = form.nome.trim().length < 2;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Papéis e permissões</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Defina papéis e quais telas cada um libera. Atribua o papel a cada
          usuário na tela de Usuários. (O resumo diário é configurado por usuário,
          não pelo papel.)
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Lista de papéis */}
        <div className="space-y-2">
          <Button onClick={novo} variant="outline" className="w-full justify-start">
            <Plus className="h-4 w-4" /> Novo papel
          </Button>
          {papeis.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => escolher(p)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-md border p-3 text-left transition-colors",
                selId === p.id ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                {p.nome}
                {p.sistema && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    sistema
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users2 className="h-3 w-3" /> {p.usuarios} · {p.permissoes.length} permissões
              </span>
            </button>
          ))}
        </div>

        {/* Editor */}
        <Card className="space-y-5 p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Nome do papel</Label>
              <Input
                value={form.nome}
                disabled={bloqueado}
                placeholder="ex: Financeiro"
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Descrição</Label>
              <Input
                value={form.descricao}
                disabled={bloqueado}
                placeholder="opcional"
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
          </div>

          {bloqueado && (
            <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              O papel <strong>Administrador</strong> tem acesso total e não pode ser
              editado.
            </p>
          )}

          <div className="space-y-4">
            {grupos.map(([modulo, itens]) => {
              const marcados = itens.filter((i) => form.permissoes.has(i.chave)).length;
              const todos = marcados === itens.length;
              return (
                <div key={modulo} className="rounded-lg border">
                  <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                    <span className="text-sm font-semibold">
                      {modulo}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({marcados}/{itens.length})
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={bloqueado}
                      onClick={() => toggleGrupo(itens, !todos)}
                      className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {todos ? "Desmarcar todos" : "Marcar todos"}
                    </button>
                  </div>
                  <div className="divide-y">
                    {agruparPorRecurso(itens).map(([recurso, acoes]) => (
                      <div
                        key={recurso}
                        className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3"
                      >
                        <span className="w-44 shrink-0 text-sm font-medium">
                          {RECURSOS_LABEL[recurso] ?? recurso}
                        </span>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {acoes.map((it) => (
                            <label
                              key={it.chave}
                              className={cn(
                                "flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-muted",
                                bloqueado && "cursor-not-allowed opacity-60",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-input"
                                checked={form.permissoes.has(it.chave)}
                                disabled={bloqueado}
                                onChange={() => toggle(it.chave)}
                              />
                              <span>{it.titulo}</span>
                              {it.escopavel && (
                                <span
                                  title="Também funciona para usuário com acesso restrito a transportadora"
                                  className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-medium text-emerald-800"
                                >
                                  frota
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t pt-4">
            <div>
              {!ehNovo && selecionado && !selecionado.sistema && (
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={excluir.isPending}
                  onClick={() => {
                    if (confirm(`Excluir o papel "${selecionado.nome}"?`)) excluir.mutate();
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Excluir
                </Button>
              )}
            </div>
            <Button
              onClick={() => salvar.mutate()}
              disabled={bloqueado || nomeInvalido || salvar.isPending}
            >
              <Save className="mr-1 h-4 w-4" />
              {salvar.isPending ? "Salvando…" : ehNovo ? "Criar papel" : "Salvar"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
