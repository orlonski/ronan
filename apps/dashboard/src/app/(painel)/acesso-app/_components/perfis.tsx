"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Coins, Eye, Pencil, Plus, Power, Users } from "lucide-react";
import { toast } from "sonner";
import {
  CAPACIDADES_APP,
  GRUPOS_CAPACIDADE_APP,
  type CapacidadeApp,
  type CapacidadeAppDef,
} from "@ronan/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido } from "@/components/requer-tela";
import { AppPreview } from "@/components/app-preview";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { pessoas, quemEntraNoGrupo } from "./frases";
import { ConfirmarMudanca } from "./simulacao";
import { CHAVE_PAINEL, type PainelAcessoApp, type PerfilApp, type Simulacao } from "./tipos";

/**
 * Os selos de um item: só os que mudam a decisão de quem liga. "Custa" (cada
 * uso entra na conta) e "só CLT" (ponto). O resto ("só muda a tela", "em
 * liberação", "da plataforma") era mecanismo à mostra e confundia.
 */
export function SelosCapacidade({ def }: { def: CapacidadeAppDef }) {
  return (
    <>
      {def.custa && (
        <span
          title="Cada uso tem custo e entra na conta"
          className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700"
        >
          <Coins className="h-3 w-3" />
          custa
        </span>
      )}
      {def.vinculo === "FUNCIONARIO" && (
        <span className="rounded bg-blue-50 px-1 text-[10px] font-semibold text-blue-700">só CLT</span>
      )}
    </>
  );
}

/** 1. OS GRUPOS: cada um diz quem entra, quantas pessoas tem e o que elas veem. */
export function Grupos({ painel }: { painel: PainelAcessoApp }) {
  const [editando, setEditando] = useState<PerfilApp | "novo" | null>(null);
  const [vendo, setVendo] = useState<PerfilApp | null>(null);
  const regras = painel.fonte === "REGRAS";

  // O grupo que é o destino padrão não pode ser desligado: "todo o resto"
  // ficaria sem nada.
  const ehPadrao = (id: string) =>
    id === painel.perfilPadraoMotoristaId || id === painel.perfilPadraoFuncionarioId;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Grupos</h2>
          <p className="text-sm text-muted-foreground">
            Cada pessoa está num grupo, e o grupo decide o que aparece no celular dela.
          </p>
        </div>
        {regras && (
          <Permitido chave="perfis-acesso.criar">
            <Button variant="outline" onClick={() => setEditando("novo")}>
              <Plus className="mr-2 h-4 w-4" />
              Novo grupo
            </Button>
          </Permitido>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {painel.perfis.map((p) => {
          const quem = quemEntraNoGrupo(painel, p.id);
          return (
            <Card key={p.id} className={`p-5 ${p.ativo ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{p.nome}</h3>
                    {!p.ativo && <Badge className="border-border text-muted-foreground">Desligado</Badge>}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {pessoas(p.pessoas)}
                    {quem.length > 0 && <> · Quem entra: {quem.join("; ")}</>}
                    {quem.length === 0 && p.ativo && (
                      <> · {p.pessoas > 0 ? "Colocadas aqui na mão" : "Ninguém é mandado pra cá ainda"}</>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" title="Ver como fica o app" onClick={() => setVendo(p)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  {regras && (
                    <Permitido chave="perfis-acesso.editar">
                      <Button variant="ghost" size="sm" title="Editar" onClick={() => setEditando(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </Permitido>
                  )}
                  {regras && !ehPadrao(p.id) && (
                    <Permitido chave="perfis-acesso.excluir">
                      <DesligarPerfil perfil={p} />
                    </Permitido>
                  )}
                </div>
              </div>
              <p className="mt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Vê no app</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {CAPACIDADES_APP.filter((c) => p.capacidades.includes(c.chave)).map((c) => (
                  <Badge key={c.chave} className="border-border text-muted-foreground">
                    {c.label}
                  </Badge>
                ))}
                {p.capacidades.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    Só o básico: entra no app e vê o que é dele.
                  </span>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {vendo && (
        <Dialog open onOpenChange={(o) => !o && setVendo(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{vendo.nome}</DialogTitle>
            </DialogHeader>
            <AppPreview capacidades={vendo.capacidades} />
            <p className="text-center text-xs text-muted-foreground">
              É o celular de quem está neste grupo. Quem tem algo só dele aparece na própria ficha.
            </p>
          </DialogContent>
        </Dialog>
      )}

      {editando && (
        <EditorPerfil
          perfil={editando === "novo" ? null : editando}
          onFechar={() => setEditando(null)}
        />
      )}
    </section>
  );
}

function DesligarPerfil({ perfil }: { perfil: PerfilApp }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  const alvo = perfil.ativo ? "desligar" : "religar";

  async function simular() {
    try {
      setSimulacao(
        await fetchApi<Simulacao>("/admin/acesso-app/simular", {
          method: "POST",
          token,
          body: JSON.stringify({
            perfil: { id: perfil.id, capacidades: perfil.capacidades, ativo: !perfil.ativo },
          }),
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" title={perfil.ativo ? "Desligar o grupo" : "Religar o grupo"} onClick={simular}>
        <Power className="h-4 w-4" />
      </Button>
      {simulacao && (
        <ConfirmarMudanca
          titulo={`${alvo === "desligar" ? "Desligar o grupo" : "Religar o grupo"} ${perfil.nome}`}
          simulacao={simulacao}
          onCancelar={() => setSimulacao(null)}
          onConfirmar={async () => {
            try {
              await fetchApi(
                perfil.ativo ? `/admin/acesso-app/perfis/${perfil.id}` : `/admin/acesso-app/perfis/${perfil.id}/religar`,
                { method: perfil.ativo ? "DELETE" : "POST", token },
              );
              toast.success(perfil.ativo ? "Grupo desligado." : "Grupo religado.");
              setSimulacao(null);
              void qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      )}
    </>
  );
}

function EditorPerfil({ perfil, onFechar }: { perfil: PerfilApp | null; onFechar: () => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [nome, setNome] = useState(perfil?.nome ?? "");
  const [descricao, setDescricao] = useState(perfil?.descricao ?? "");
  const [caps, setCaps] = useState<Set<CapacidadeApp>>(
    new Set((perfil?.capacidades ?? []) as CapacidadeApp[]),
  );
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const custaLigado = useMemo(() => CAPACIDADES_APP.some((c) => c.custa && caps.has(c.chave)), [caps]);
  const capacidades = CAPACIDADES_APP.filter((c) => caps.has(c.chave)).map((c) => c.chave);

  async function salvar() {
    await fetchApi(perfil ? `/admin/acesso-app/perfis/${perfil.id}` : "/admin/acesso-app/perfis", {
      method: perfil ? "PATCH" : "POST",
      token,
      body: JSON.stringify({ nome, descricao: descricao.trim() || null, capacidades }),
    });
    toast.success("Grupo salvo.");
    void qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
    onFechar();
  }

  async function continuar() {
    setOcupado(true);
    try {
      // Perfil novo não tem ninguém ainda: não há o que simular.
      if (!perfil) {
        await salvar();
        return;
      }
      setSimulacao(
        await fetchApi<Simulacao>("/admin/acesso-app/simular", {
          method: "POST",
          token,
          body: JSON.stringify({ perfil: { id: perfil.id, capacidades, ativo: perfil.ativo } }),
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (simulacao) {
    return (
      <ConfirmarMudanca
        titulo={`Salvar ${nome}`}
        simulacao={simulacao}
        onCancelar={() => setSimulacao(null)}
        onConfirmar={async () => {
          try {
            await salvar();
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{perfil ? `Grupo ${perfil.nome}` : "Novo grupo"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Agregados" />
            </div>
            <div>
              <Label>Observação (opcional)</Label>
              <Textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={2}
                placeholder="Pra que serve este grupo."
              />
            </div>
            <p className="text-sm font-medium">O que este grupo vê no celular</p>
            {GRUPOS_CAPACIDADE_APP.map((grupo) => {
              const doGrupo = CAPACIDADES_APP.filter((c) => c.grupo === grupo);
              if (!doGrupo.length) return null;
              return (
                <div key={grupo} className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{grupo}</p>
                  <div className="mt-2 space-y-3">
                    {doGrupo.map((c) => (
                      <div key={c.chave} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            {c.label}
                            <SelosCapacidade def={c} />
                          </p>
                          <p className="text-xs text-muted-foreground">{c.efeito}</p>
                        </div>
                        <StatusToggle
                          active={caps.has(c.chave)}
                          onChange={(v: boolean) =>
                            setCaps((prev) => {
                              const n = new Set(prev);
                              if (v) n.add(c.chave);
                              else n.delete(c.chave);
                              return n;
                            })
                          }
                          size="sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {custaLigado && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <Coins className="mt-0.5 h-4 w-4 shrink-0" />
                Este grupo liga um recurso cobrado por uso: todo mundo do grupo passa a consumir.
              </p>
            )}
          </div>
          <div className="md:sticky md:top-0 md:self-start">
            <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Como fica o app
            </p>
            <AppPreview capacidades={capacidades} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={continuar} disabled={ocupado || nome.trim().length < 2}>
            {ocupado ? "Um instante…" : perfil ? "Salvar" : "Criar grupo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
