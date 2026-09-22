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
import { ConfirmarMudanca } from "./simulacao";
import { CHAVE_PAINEL, type PainelAcessoApp, type PerfilApp, type Simulacao } from "./tipos";

/** Os selos que dizem o que uma capacidade É, antes de alguém ligá-la. */
export function SelosCapacidade({ def, contratado }: { def: CapacidadeAppDef; contratado?: boolean }) {
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
        <span className="rounded bg-blue-50 px-1 text-[10px] font-semibold text-blue-700">só registrado</span>
      )}
      {def.regimesProibidos?.includes("EMPREGADO") && (
        <span
          title="Quem é registrado em carteira não recebe isto: é de quem é parceiro"
          className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-700"
        >
          só parceiro
        </span>
      )}
      {def.gate === "SO_TELA" && (
        <span
          title="O servidor não barra: só aparece ou some da tela dele"
          className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600"
        >
          só muda a tela
        </span>
      )}
      {def.tipo !== "EMPRESA" && (
        <span
          title="Liberado pela plataforma, empresa por empresa"
          className="rounded bg-violet-50 px-1 text-[10px] font-semibold text-violet-700"
        >
          {def.tipo === "ROLLOUT" ? "em liberação" : "da plataforma"}
        </span>
      )}
      {contratado === false && (
        <span className="rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
          módulo não contratado
        </span>
      )}
    </>
  );
}

export function AbaPerfis({ painel }: { painel: PainelAcessoApp }) {
  const [editando, setEditando] = useState<PerfilApp | "novo" | null>(null);
  const [vendo, setVendo] = useState<PerfilApp | null>(null);
  const regras = painel.fonte === "REGRAS";

  const papelDo = (id: string) =>
    id === painel.perfilPadraoMotoristaId
      ? "Padrão de quem dirige"
      : id === painel.perfilPadraoFuncionarioId
        ? "Padrão de quem é só registrado"
        : null;

  return (
    <div className="space-y-4">
      {regras && (
        <Permitido chave="perfis-acesso.criar">
          <div className="flex justify-end">
            <Button onClick={() => setEditando("novo")}>
              <Plus className="mr-2 h-4 w-4" />
              Novo perfil
            </Button>
          </div>
        </Permitido>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {painel.perfis.map((p) => {
          const papel = papelDo(p.id);
          return (
            <Card key={p.id} className={`p-5 ${p.ativo ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{p.nome}</h2>
                    {!p.ativo && <Badge className="border-border text-muted-foreground">Desligado</Badge>}
                    {papel && <Badge className="border-blue-300 bg-blue-50 text-blue-700">{papel}</Badge>}
                  </div>
                  {p.descricao && <p className="mt-1 text-sm text-muted-foreground">{p.descricao}</p>}
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {p.pessoas === 0 ? "Ninguém neste perfil" : p.pessoas === 1 ? "1 pessoa" : `${p.pessoas} pessoas`}
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
                  {regras && !papel && (
                    <Permitido chave="perfis-acesso.excluir">
                      <DesligarPerfil perfil={p} />
                    </Permitido>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CAPACIDADES_APP.filter((c) => p.capacidades.includes(c.chave)).map((c) => (
                  <Badge key={c.chave} className="border-border text-muted-foreground">
                    {c.label}
                  </Badge>
                ))}
                {p.capacidades.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    Nenhum acesso — só entra no app e vê o que é dele.
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
              Sem contar exceções e travas de cada pessoa. Pra ver uma pessoa de verdade, abra a
              ficha dela.
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
    </div>
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
      <Button variant="ghost" size="sm" title={perfil.ativo ? "Desligar" : "Religar"} onClick={simular}>
        <Power className="h-4 w-4" />
      </Button>
      {simulacao && (
        <ConfirmarMudanca
          titulo={`${alvo === "desligar" ? "Desligar" : "Religar"} ${perfil.nome}`}
          simulacao={simulacao}
          onCancelar={() => setSimulacao(null)}
          onConfirmar={async () => {
            try {
              await fetchApi(
                perfil.ativo ? `/admin/acesso-app/perfis/${perfil.id}` : `/admin/acesso-app/perfis/${perfil.id}/religar`,
                { method: perfil.ativo ? "DELETE" : "POST", token },
              );
              toast.success(perfil.ativo ? "Perfil desligado." : "Perfil religado.");
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
    toast.success("Perfil salvo.");
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
          <DialogTitle>{perfil ? `Editar ${perfil.nome}` : "Novo perfil"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Motorista de frete" />
            </div>
            <div>
              <Label>Pra que serve (opcional)</Label>
              <Textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={2}
                placeholder="Quem roda frete pra empresa e lança viagem pelo app."
              />
            </div>
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
                Este perfil liga um recurso que é cobrado por uso. Todo mundo que cair nele passa a
                consumir.
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
            {ocupado ? "Calculando…" : perfil ? "Ver quem muda" : "Criar perfil"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
