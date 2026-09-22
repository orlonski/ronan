"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Coins, Pencil, Plus, Power, Users } from "lucide-react";
import { toast } from "sonner";
import {
  ACESSOS_APP,
  ACESSOS_APP_CHAVES,
  ACESSOS_APP_GRUPOS,
  type AcessoAppChave,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { StatusToggle } from "@/components/status-toggle";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingCard } from "@/components/loading";
import { ErroCard } from "@/components/erro-estado";
import { RequerTela, Permitido } from "@/components/requer-tela";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";

type Perfil = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  sugeridoPara: "PARCEIRO" | "EMPREGADO" | null;
  motoristas: number;
  acessos: Record<AcessoAppChave, boolean>;
};

const VAZIO = Object.fromEntries(ACESSOS_APP_CHAVES.map((c) => [c, false])) as Record<
  AcessoAppChave,
  boolean
>;

export default function PerfisAcessoPage() {
  return (
    <RequerTela chave="perfis-acesso.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const qc = useQueryClient();
  const token = useAuthToken();
  const lista = useApiQuery<Perfil[]>("/admin/perfis-acesso");
  const [editando, setEditando] = useState<Perfil | "novo" | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Perfis de acesso do app</h1>
          <p className="text-sm text-muted-foreground">
            O que cada tipo de motorista enxerga no celular. Você escolhe o perfil no
            cadastro, em vez de responder treze perguntas por pessoa.
          </p>
        </div>
        <Permitido chave="perfis-acesso.criar">
          <Button onClick={() => setEditando("novo")}>
            <Plus className="mr-2 h-4 w-4" />
            Novo perfil
          </Button>
        </Permitido>
      </div>

      {lista.isLoading && <LoadingCard />}
      {lista.error && <ErroCard erro={lista.error} onRetry={() => lista.refetch()} />}

      {lista.data?.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm font-medium">Nenhum perfil ainda.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Enquanto não houver, cada motorista segue com os acessos que já tem — nada
            muda sozinho. Crie o primeiro quando quiser parar de ligar um por um.
          </p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {lista.data?.map((p) => (
          <Card key={p.id} className={`p-5 ${p.ativo ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{p.nome}</h2>
                  {!p.ativo && <Badge className="border-border text-muted-foreground">Desligado</Badge>}
                  {p.sugeridoPara === "EMPREGADO" && (
                    <Badge className="border-blue-300 bg-blue-50 text-blue-700">
                      Sugerido pra registrado
                    </Badge>
                  )}
                </div>
                {p.descricao && (
                  <p className="mt-1 text-sm text-muted-foreground">{p.descricao}</p>
                )}
                <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  {p.motoristas === 0
                    ? "Ninguém neste perfil"
                    : p.motoristas === 1
                      ? "1 motorista"
                      : `${p.motoristas} motoristas`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Permitido chave="perfis-acesso.editar">
                  <Button variant="ghost" size="sm" onClick={() => setEditando(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Permitido>
                <Permitido chave="perfis-acesso.excluir">
                  {p.ativo && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const r = await fetchApi<{ soltos: number }>(
                          `/admin/perfis-acesso/${p.id}`,
                          { method: "DELETE", token },
                        ).catch((e) => {
                          toast.error(String((e as Error).message));
                          return null;
                        });
                        if (!r) return;
                        toast.success(
                          r.soltos === 0
                            ? "Perfil desligado."
                            : `Perfil desligado. ${r.soltos} motorista(s) seguem com os acessos que já tinham.`,
                        );
                        void qc.invalidateQueries({ queryKey: ["/admin/perfis-acesso"] });
                      }}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                  )}
                </Permitido>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {ACESSOS_APP.filter((a) => p.acessos[a.chave]).map((a) => (
                <Badge key={a.chave} className="border-border text-muted-foreground">
                  {a.label}
                </Badge>
              ))}
              {ACESSOS_APP.every((a) => !p.acessos[a.chave]) && (
                <span className="text-sm text-muted-foreground">
                  Nenhum acesso — só entra no app e vê o que é dele.
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>

      {editando && (
        <FormPerfil
          perfil={editando === "novo" ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvou={() => {
            setEditando(null);
            void qc.invalidateQueries({ queryKey: ["/admin/perfis-acesso"] });
          }}
        />
      )}
    </div>
  );
}

function FormPerfil({
  perfil,
  onFechar,
  onSalvou,
}: {
  perfil: Perfil | null;
  onFechar: () => void;
  onSalvou: () => void;
}) {
  const token = useAuthToken();
  const [nome, setNome] = useState(perfil?.nome ?? "");
  const [descricao, setDescricao] = useState(perfil?.descricao ?? "");
  const [sugeridoPara, setSugeridoPara] = useState(perfil?.sugeridoPara ?? "");
  const [acessos, setAcessos] = useState<Record<AcessoAppChave, boolean>>(
    perfil?.acessos ?? VAZIO,
  );
  const [salvando, setSalvando] = useState(false);

  const custaLigado = useMemo(
    () => ACESSOS_APP.some((a) => a.custa && acessos[a.chave]),
    [acessos],
  );

  async function salvar() {
    setSalvando(true);
    try {
      const body = {
        nome,
        descricao: descricao.trim() || null,
        sugeridoPara: sugeridoPara || null,
        acessos,
      };
      const r = await fetchApi<{ motoristasAtualizados?: number }>(
        perfil ? `/admin/perfis-acesso/${perfil.id}` : "/admin/perfis-acesso",
        { method: perfil ? "PATCH" : "POST", body: JSON.stringify(body), token },
      );
      toast.success(
        r.motoristasAtualizados
          ? `Perfil salvo. ${r.motoristasAtualizados} motorista(s) foram atualizados.`
          : "Perfil salvo.",
      );
      onSalvou();
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{perfil ? `Editar ${perfil.nome}` : "Novo perfil de acesso"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Motorista de frete"
            />
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

          <div>
            <Label>Sugerir este perfil pra quem é</Label>
            <Select
              value={sugeridoPara}
              onChange={(e) => setSugeridoPara(e.target.value as typeof sugeridoPara)}
            >
              <option value="">Não sugerir</option>
              <option value="PARCEIRO">Parceiro autônomo</option>
              <option value="EMPREGADO">Registrado em carteira</option>
            </Select>
            {/* ⚠️ A frase não é decorativa: sem ela alguém supõe que escolher
                "registrado" aqui impede a pessoa de lançar viagem — e o
                motorista CLT da própria transportadora dirige e lança. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Só aparece como sugestão no cadastro. Não impede nada: motorista registrado
              em carteira também dirige e lança viagem.
            </p>
          </div>

          {ACESSOS_APP_GRUPOS.map((grupo) => {
            const doGrupo = ACESSOS_APP.filter((a) => a.grupo === grupo);
            if (doGrupo.length === 0) return null;
            return (
              <div key={grupo} className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {grupo}
                </p>
                <div className="mt-2 space-y-3">
                  {doGrupo.map((a) => (
                    <div key={a.chave} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {a.label}
                          {a.custa && (
                            <span
                              title="Cada uso chama a inteligência artificial e entra na conta"
                              className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700"
                            >
                              <Coins className="h-3 w-3" />
                              custa
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{a.efeito}</p>
                      </div>
                      <StatusToggle
                        active={acessos[a.chave]}
                        onChange={(v: boolean) =>
                          setAcessos((prev) => ({ ...prev, [a.chave]: v }))
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
              Este perfil liga um recurso que é cobrado por uso. Todo motorista que
              entrar nele passa a consumir.
            </p>
          )}

          {/* ⚠️ O aviso vem ANTES do botão, não depois de salvar. Aplicar um
              molde apaga as exceções de quem está nele — e exceção que alguém
              pôs semana passada some sem a pessoa saber. */}
          {perfil && perfil.motoristas > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-warning bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Salvar reescreve os acessos de <strong>{perfil.motoristas}</strong>{" "}
                motorista(s) que estão neste perfil — inclusive quem tinha alguma
                diferença lançada à mão.
              </span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || nome.trim().length < 2}>
            {salvando ? "Salvando…" : "Salvar perfil"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
