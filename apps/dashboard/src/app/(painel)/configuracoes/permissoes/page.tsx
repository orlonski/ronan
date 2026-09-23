"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, ShieldCheck, Trash2, Users2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RECURSOS_LABEL, agruparRecursosPorMenu } from "@ronan/shared-types";
import { estruturaDoMenu } from "@/components/sidebar";
import { ABAS } from "@/components/abas-da-tela";
import { usePermissoes } from "@/lib/permissoes";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { RequerTela } from "@/components/requer-tela";
import { PublicarModelo, UsarModelo } from "./_components/modelos";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { AbasPermissoes } from "@/components/abas-permissoes";

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

// Rótulo de cada aba pelo href, das abas da própria tela (abas-da-tela.tsx).
const ROTULO_ABA: Record<string, string> = Object.fromEntries(
  Object.values(ABAS).flatMap((abas) => abas.map((a) => [a.href, a.label] as const)),
);

type LinhaRecurso = { recurso: string; rotulo: string; aba: boolean; tambemEm: string[]; acoes: PermissaoRow[] };

export default function PermissoesPage() {
  return (
    <RequerTela chave="permissoes.gerenciar">
      <PermissoesInner />
    </RequerTela>
  );
}

function PermissoesInner() {
  const { confirmar, ConfirmDialog } = useConfirm();
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

  const { plataforma } = usePermissoes();

  // Catálogo agrupado PELO MENU (ver shared-types/matriz-por-menu.ts): cada
  // grupo do menu vira uma seção, cada item uma linha e cada aba uma sub-linha.
  // O que o menu não alcança cai em "Sem item próprio no menu". As ações de
  // cada recurso seguem na ordem do backend.
  const grupos = useMemo(() => {
    const acoesPorRecurso = new Map<string, PermissaoRow[]>();
    for (const p of catalogo.data ?? []) {
      const recurso = p.chave.split(".")[0] ?? p.chave;
      const arr = acoesPorRecurso.get(recurso) ?? [];
      arr.push(p);
      acoesPorRecurso.set(recurso, arr);
    }
    const recursos = [...acoesPorRecurso.keys()];
    const menu = estruturaDoMenu().filter((g) => !g.soPlataforma || plataforma);
    const secoes = agruparRecursosPorMenu(menu, recursos, {
      aba: (href) => ROTULO_ABA[href],
      recurso: (r) => RECURSOS_LABEL[r],
    });

    if (process.env.NODE_ENV !== "production") {
      // Nenhum recurso do catálogo pode sumir da matriz. Repetir é esperado:
      // item do menu que divide a chave com outro tem linha própria.
      const vistos = secoes.flatMap((s) => s.linhas.map((l) => l.recurso));
      const faltando = recursos.filter((r) => !vistos.includes(r));
      if (faltando.length) {
        console.error("[permissoes] matriz fora do catálogo", { faltando });
      }
    }

    return secoes.map((s) => {
      const linhas: LinhaRecurso[] = s.linhas.map((l) => ({
        ...l,
        acoes: acoesPorRecurso.get(l.recurso) ?? [],
      }));
      return { titulo: s.titulo, linhas, itens: linhas.flatMap((l) => l.acoes) };
    });
  }, [catalogo.data, plataforma]);

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
    <ConfirmDialog />
      <AbasPermissoes />
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
          <UsarModelo
            onCopiado={(id) => {
              // Abre a cópia já selecionada: quem copia quase sempre quer
              // conferir e ajustar antes de atribuir a alguém.
              void qc
                .invalidateQueries({ queryKey: [PATH_PAPEIS] })
                .then(() => setSelId(id));
            }}
          />
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

          <PublicarModelo
            papel={
              selecionado
                ? {
                    id: selecionado.id,
                    nome: selecionado.nome,
                    descricao: selecionado.descricao,
                    permissoes: selecionado.permissoes,
                  }
                : null
            }
          />
        </div>

        {/* Editor */}
        <Card className="space-y-5 p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="page-nome-do-papel">Nome do papel</Label>
              <Input id="page-nome-do-papel"
                value={form.nome}
                disabled={bloqueado}
                placeholder="ex: Financeiro"
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="page-descricao">Descrição</Label>
              <Input id="page-descricao"
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
            {grupos.map(({ titulo, linhas, itens }) => {
              const marcados = itens.filter((i) => form.permissoes.has(i.chave)).length;
              const todos = marcados === itens.length;
              return (
                <div key={titulo} className="rounded-lg border">
                  <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                    <span className="text-sm font-semibold">
                      {titulo}{" "}
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
                    {linhas.map(({ recurso, rotulo, aba, tambemEm, acoes }) => (
                      <div
                        key={recurso}
                        className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3"
                      >
                        <span
                          title={RECURSOS_LABEL[recurso]}
                          className={cn(
                            "w-44 shrink-0 text-sm",
                            aba ? "pl-3 text-muted-foreground" : "font-medium",
                          )}
                        >
                          {rotulo}
                          {tambemEm.length > 0 && (
                            <span className="block text-[11px] font-normal text-muted-foreground">
                              mesma permissão de {tambemEm.join(", ")} — marcar aqui marca lá
                            </span>
                          )}
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
                  variant="destructive"
                  disabled={excluir.isPending}
                  onClick={async () => {
                    const ok = await confirmar({
                      variant: "destructive",
                      title: `Excluir o papel "${selecionado.nome}"?`,
                      description:
                        "Quem estiver com esse papel fica sem nenhuma permissão até você dar outro.",
                      confirmLabel: "Excluir papel",
                      cancelLabel: "Voltar",
                    });
                    if (ok) excluir.mutate();
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
