"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { RegraAcessoAppInput } from "@ronan/shared-types";
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
import { Select } from "@/components/ui/select";
import { StatusToggle } from "@/components/status-toggle";
import { usePermissoes } from "@/lib/permissoes";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { ConfirmarMudanca } from "./simulacao";
import { CHAVE_PAINEL, type PainelAcessoApp, type Simulacao } from "./tipos";

type Regra = RegraAcessoAppInput;

const VINCULO: Record<Regra["vinculo"], string> = {
  QUALQUER: "qualquer pessoa",
  MOTORISTA: "quem tem cadastro de motorista",
  FUNCIONARIO: "quem é registrado (bate ponto)",
};
const REGIME: Record<Regra["regime"], string> = {
  QUALQUER: "",
  PARCEIRO: "é parceiro",
  EMPREGADO: "é registrado em carteira (CLT)",
  NAO_DECLARADO: "não tem regime declarado",
};

/**
 * QUEM RECEBE QUAL PERFIL — em frases, na ordem em que são avaliadas.
 *
 * ⚠️ Frases e setas, não arrastar: "a primeira que casa vence" é o ponto em
 * que o escritório erra, e ver a lista como texto lido de cima pra baixo é o
 * que torna isso óbvio. A última linha é fixa: todo o resto cai no padrão.
 */
export function AbaQuemRecebe({ painel }: { painel: PainelAcessoApp }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeEditar = painel.fonte === "REGRAS" && temPermissao("perfis-acesso.editar");
  const [regras, setRegras] = useState<Regra[]>(() =>
    painel.regras.map(({ ordem: _o, ...r }) => r),
  );
  const [padraoM, setPadraoM] = useState(painel.perfilPadraoMotoristaId ?? "");
  const [padraoF, setPadraoF] = useState(painel.perfilPadraoFuncionarioId ?? "");
  const [editando, setEditando] = useState<{ indice: number | null; regra: Regra } | null>(null);
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);

  const perfisAtivos = painel.perfis.filter((p) => p.ativo);
  const nomePerfil = (id: string | null | undefined) => painel.perfis.find((p) => p.id === id)?.nome ?? "—";
  const nomeModalidade = (id?: string | null) => painel.opcoes.modalidades.find((m) => m.id === id)?.nome;
  const nomeTransp = (id?: string | null) => painel.opcoes.transportadoras.find((t) => t.id === id)?.nome;

  const alterado =
    JSON.stringify(regras) !== JSON.stringify(painel.regras.map(({ ordem: _o, ...r }) => r)) ||
    padraoM !== (painel.perfilPadraoMotoristaId ?? "") ||
    padraoF !== (painel.perfilPadraoFuncionarioId ?? "");

  function frase(r: Regra) {
    const partes = [VINCULO[r.vinculo]];
    if (r.regime !== "QUALQUER") partes.push(`que ${REGIME[r.regime]}`);
    const mod = nomeModalidade(r.modalidadeId);
    if (mod) partes.push(`com modalidade ${mod}`);
    const tr = nomeTransp(r.transportadoraId);
    if (tr) partes.push(`da transportadora ${tr}`);
    return partes.join(", ");
  }

  function mover(i: number, d: -1 | 1) {
    setRegras((prev) => {
      const n = [...prev];
      const [x] = n.splice(i, 1);
      n.splice(i + d, 0, x!);
      return n;
    });
  }

  const corpo = {
    regras,
    padrao: { perfilPadraoMotoristaId: padraoM || null, perfilPadraoFuncionarioId: padraoF || null },
  };

  async function simular() {
    try {
      setSimulacao(
        await fetchApi<Simulacao>("/admin/acesso-app/simular", {
          method: "POST",
          token,
          body: JSON.stringify(corpo),
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Lido de cima pra baixo: cada pessoa recebe o perfil da <strong>primeira</strong> frase que
        vale pra ela. Quem nenhuma alcança cai no padrão, lá embaixo. Exceções por pessoa ficam na
        ficha dela.
      </p>

      <Card className="divide-y divide-border">
        {regras.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            Nenhuma regra: todo mundo cai no padrão.
          </p>
        )}
        {regras.map((r, i) => (
          <div key={r.id ?? `n${i}`} className={`flex items-center gap-3 p-3 ${r.ativo ? "" : "opacity-50"}`}>
            <span className="w-6 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                Se é <strong>{frase(r)}</strong> → <strong>{nomePerfil(r.perfilId)}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                {r.nome}
                {!r.ativo && " · desligada"}
              </p>
            </div>
            {podeEditar && (
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => mover(i, -1)} title="Subir">
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={i === regras.length - 1}
                  onClick={() => mover(i, 1)}
                  title="Descer"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditando({ indice: i, regra: r })} title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRegras((prev) => prev.filter((_, j) => j !== i))}
                  title="Tirar esta regra"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 bg-muted/30 p-3">
          <Badge className="border-border text-muted-foreground">Todo o resto</Badge>
          <span className="text-sm">Quem dirige →</span>
          <Select
            className="w-56"
            value={padraoM}
            disabled={!podeEditar}
            onChange={(e) => setPadraoM(e.target.value)}
          >
            <option value="">Nenhum (sem acesso)</option>
            {perfisAtivos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Select>
          <span className="text-sm">Quem é só registrado →</span>
          <Select
            className="w-56"
            value={padraoF}
            disabled={!podeEditar}
            onChange={(e) => setPadraoF(e.target.value)}
          >
            <option value="">Nenhum (sem acesso)</option>
            {perfisAtivos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {podeEditar && (
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setEditando({
                indice: null,
                regra: {
                  nome: "",
                  ativo: true,
                  vinculo: "QUALQUER",
                  regime: "QUALQUER",
                  modalidadeId: null,
                  transportadoraId: null,
                  perfilId: perfisAtivos[0]?.id ?? "",
                },
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar regra
          </Button>
          <div className="flex gap-2">
            {alterado && (
              <Button
                variant="outline"
                onClick={() => {
                  setRegras(painel.regras.map(({ ordem: _o, ...r }) => r));
                  setPadraoM(painel.perfilPadraoMotoristaId ?? "");
                  setPadraoF(painel.perfilPadraoFuncionarioId ?? "");
                }}
              >
                Desfazer
              </Button>
            )}
            <Button disabled={!alterado} onClick={simular}>
              Ver quem muda
            </Button>
          </div>
        </div>
      )}

      {editando && (
        <EditorRegra
          painel={painel}
          regra={editando.regra}
          onFechar={() => setEditando(null)}
          onPronto={(r) => {
            setRegras((prev) =>
              editando.indice === null ? [...prev, r] : prev.map((x, j) => (j === editando.indice ? r : x)),
            );
            setEditando(null);
          }}
        />
      )}

      {simulacao && (
        <ConfirmarMudanca
          titulo="Salvar quem recebe o quê"
          simulacao={simulacao}
          onCancelar={() => setSimulacao(null)}
          onConfirmar={async () => {
            try {
              await fetchApi("/admin/acesso-app/regras", {
                method: "PUT",
                token,
                body: JSON.stringify({ regras }),
              });
              await fetchApi("/admin/acesso-app/padrao", {
                method: "PUT",
                token,
                body: JSON.stringify(corpo.padrao),
              });
              toast.success("Salvo.");
              setSimulacao(null);
              void qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

function EditorRegra({
  painel,
  regra,
  onFechar,
  onPronto,
}: {
  painel: PainelAcessoApp;
  regra: Regra;
  onFechar: () => void;
  onPronto: (r: Regra) => void;
}) {
  const [r, setR] = useState<Regra>(regra);
  const set = <K extends keyof Regra>(k: K, v: Regra[K]) => setR((p) => ({ ...p, [k]: v }));
  const soMotorista = r.vinculo === "FUNCIONARIO";

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{regra.nome ? `Regra: ${regra.nome}` : "Nova regra"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome da regra</Label>
            <Input value={r.nome} onChange={(e) => set("nome", e.target.value)} placeholder="CLT que dirige" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quem</Label>
              <Select value={r.vinculo} onChange={(e) => set("vinculo", e.target.value as Regra["vinculo"])}>
                <option value="QUALQUER">Qualquer pessoa</option>
                <option value="MOTORISTA">Tem cadastro de motorista</option>
                <option value="FUNCIONARIO">É registrado (bate ponto)</option>
              </Select>
            </div>
            <div>
              <Label>Regime</Label>
              <Select value={r.regime} onChange={(e) => set("regime", e.target.value as Regra["regime"])}>
                <option value="QUALQUER">Tanto faz</option>
                <option value="EMPREGADO">Registrado em carteira (CLT)</option>
                <option value="PARCEIRO">Parceiro (obra e diária)</option>
                <option value="NAO_DECLARADO">Sem regime declarado (frete comum)</option>
              </Select>
            </div>
            <div>
              <Label>Modalidade</Label>
              <Select
                value={r.modalidadeId ?? ""}
                disabled={soMotorista}
                onChange={(e) => set("modalidadeId", e.target.value || null)}
              >
                <option value="">Tanto faz</option>
                {painel.opcoes.modalidades.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Transportadora</Label>
              <Select
                value={r.transportadoraId ?? ""}
                disabled={soMotorista}
                onChange={(e) => set("transportadoraId", e.target.value || null)}
              >
                <option value="">Tanto faz</option>
                {painel.opcoes.transportadoras.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {soMotorista && (
            <p className="text-xs text-muted-foreground">
              Modalidade e transportadora são do cadastro de motorista — não valem pra quem é só
              registrado.
            </p>
          )}
          <div>
            <Label>Recebe o perfil</Label>
            <Select value={r.perfilId} onChange={(e) => set("perfilId", e.target.value)}>
              {painel.perfis
                .filter((p) => p.ativo)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Regra ligada</Label>
            <StatusToggle active={r.ativo} onChange={(v: boolean) => set("ativo", v)} size="sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button disabled={r.nome.trim().length < 2 || !r.perfilId} onClick={() => onPronto(r)}>
            Usar esta regra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
