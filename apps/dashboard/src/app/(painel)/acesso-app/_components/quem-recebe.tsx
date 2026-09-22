"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CAPACIDADES_APP, type RegraAcessoAppInput } from "@ronan/shared-types";
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
import Link from "next/link";
import { Permitido } from "@/components/requer-tela";
import { fraseDaRegra } from "./frases";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { ConfirmarMudanca } from "./simulacao";
import { CHAVE_PAINEL, type PainelAcessoApp, type Simulacao } from "./tipos";

type Regra = RegraAcessoAppInput;

/**
 * 2. QUEM ENTRA EM CADA GRUPO — primeiro em frases, só leitura; o editor abre
 * no "Mudar".
 *
 * ⚠️ Frases e setas, não arrastar: "a primeira regra que vale ganha" é o
 * ponto em que o escritório erra, e ler a lista de cima pra baixo é o que
 * torna isso óbvio. As duas últimas linhas são fixas: todo motorista e todo
 * registrado caem num grupo, mesmo sem regra nenhuma.
 */
export function QuemEntra({ painel }: { painel: PainelAcessoApp }) {
  const [aberto, setAberto] = useState(false);
  const nome = (id: string | null | undefined) => painel.perfis.find((p) => p.id === id)?.nome ?? "nenhum grupo";
  const ativas = painel.regras.filter((r) => r.ativo);
  const podeEditar = painel.fonte === "REGRAS";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Quem entra em cada grupo</h2>
          <p className="text-sm text-muted-foreground">
            Motorista novo já entra no grupo certo, sem ninguém precisar lembrar.
          </p>
        </div>
        {podeEditar && !aberto && (
          <Permitido chave="perfis-acesso.editar">
            <Button variant="outline" onClick={() => setAberto(true)}>
              Mudar
            </Button>
          </Permitido>
        )}
      </div>
      {!aberto ? (
        <Card className="divide-y divide-border">
          {ativas.map((r) => (
            <p key={r.id} className="p-3 text-sm">
              {fraseDaRegra(painel, r)} → <strong>{nome(r.perfilId)}</strong>
            </p>
          ))}
          <p className="p-3 text-sm">
            {ativas.length ? "Os outros motoristas" : "Todo motorista"} →{" "}
            <strong>{nome(painel.perfilPadraoMotoristaId)}</strong>
          </p>
          <p className="p-3 text-sm">
            Quem é registrado em carteira (CLT) → <strong>{nome(painel.perfilPadraoFuncionarioId)}</strong>
          </p>
        </Card>
      ) : (
        <EditorQuemEntra painel={painel} onFechar={() => setAberto(false)} />
      )}
      {!aberto && podeEditar && <SugestaoClt painel={painel} />}
      {/* ⚠️ A pergunta que o dono fez olhando esta tela: "como eu diferencio o
          CLT de quem não é?". A resposta tem que estar AQUI, não num manual. */}
      {!aberto && (
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Quem é CLT?</strong> Quem a empresa cadastrou em{" "}
          <Link href="/ponto/funcionarios" className="underline">
            Quem bate ponto
          </Link>{" "}
          (“Registrar contratação”). Todo o resto é motorista parceiro. Quem é as duas coisas (o CLT
          que também dirige) recebe os dois grupos somados.
        </p>
      )}
    </section>
  );
}

function EditorQuemEntra({ painel, onFechar }: { painel: PainelAcessoApp; onFechar: () => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeEditar = painel.fonte === "REGRAS" && temPermissao("perfis-acesso.editar");
  void onFechar;
  const [regras, setRegras] = useState<Regra[]>(() =>
    painel.regras.map(({ ordem: _o, ...r }) => r),
  );
  const [padraoM, setPadraoM] = useState(painel.perfilPadraoMotoristaId ?? "");
  const [padraoF, setPadraoF] = useState(painel.perfilPadraoFuncionarioId ?? "");
  const [editando, setEditando] = useState<{ indice: number | null; regra: Regra } | null>(null);
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);

  const perfisAtivos = painel.perfis.filter((p) => p.ativo);
  const nomePerfil = (id: string | null | undefined) => painel.perfis.find((p) => p.id === id)?.nome ?? "—";

  const alterado =
    JSON.stringify(regras) !== JSON.stringify(painel.regras.map(({ ordem: _o, ...r }) => r)) ||
    padraoM !== (painel.perfilPadraoMotoristaId ?? "") ||
    padraoF !== (painel.perfilPadraoFuncionarioId ?? "");

  const frase = (r: Regra) => fraseDaRegra(painel, r);

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
        As regras especiais são lidas de cima pra baixo, e vale a <strong>primeira</strong> que
        servir pra pessoa. Quem nenhuma alcança cai nas duas linhas de baixo.
      </p>

      <Card className="divide-y divide-border">
        {regras.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            Nenhuma regra especial. É o normal: a maioria das empresas não precisa.
          </p>
        )}
        {regras.map((r, i) => (
          <div key={r.id ?? `n${i}`} className={`flex items-center gap-3 p-3 ${r.ativo ? "" : "opacity-50"}`}>
            <span className="w-6 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <strong>{frase(r)}</strong> → <strong>{nomePerfil(r.perfilId)}</strong>
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
          <span className="text-sm">Todo motorista →</span>
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
          <span className="text-sm">Quem é registrado (CLT) →</span>
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
            Adicionar regra especial
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onFechar}>
              {alterado ? "Cancelar" : "Fechar"}
            </Button>
            <Button disabled={!alterado} onClick={simular}>
              Salvar
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
          titulo="Salvar quem entra em cada grupo"
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
              onFechar();
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
          <DialogTitle>{regra.nome ? `Regra: ${regra.nome}` : "Nova regra especial"}</DialogTitle>
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
            <Label>Entra no grupo</Label>
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

/**
 * O MENU TEM QUE FAZER SENTIDO PRO CLT (pedido do dono).
 *
 * O CLT que também dirige cai no grupo dos motoristas, e ali estão diária,
 * presença na obra e acertos: pagamento de PARCEIRO, que não existe pra quem
 * recebe pela folha. A trava de regime que cortaria isso nasce desligada
 * (ninguém perde nada sem o dono ver), então a tela SUGERE o grupo certo, com
 * a lista de quem muda antes de aplicar.
 *
 * Some sozinha quando já existe regra pro CLT, ou quando o grupo dos
 * motoristas não tem nada que seja só de parceiro.
 */
function SugestaoClt({ painel }: { painel: PainelAcessoApp }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  const [rascunho, setRascunho] = useState<{ id: string; regras: Regra[] } | null>(null);
  const { temPermissao } = usePermissoes();

  const padrao = painel.perfis.find((p) => p.id === painel.perfilPadraoMotoristaId);
  const soDeParceiro = CAPACIDADES_APP.filter((c) => c.regimesProibidos?.includes("EMPREGADO"));
  const tira = soDeParceiro.filter((c) => padrao?.capacidades.includes(c.chave));
  const jaTemRegra = painel.regras.some((r) => r.ativo && r.regime === "EMPREGADO");
  if (!padrao || !tira.length || jaTemRegra || !temPermissao("perfis-acesso.criar")) return null;

  const capacidades = padrao.capacidades.filter((c) => !tira.some((t) => t.chave === c));
  const NOME = `${padrao.nome} CLT`;
  const regraDoClt = (perfilId: string): Regra => ({
    nome: "CLT que dirige",
    ativo: true,
    vinculo: "MOTORISTA",
    regime: "EMPREGADO",
    modalidadeId: null,
    transportadoraId: null,
    perfilId,
  });
  const regrasAtuais = painel.regras.map(({ ordem: _o, ...r }) => r);

  async function ver() {
    const id = crypto.randomUUID();
    // A regra nova vai PRIMEIRO: ela é mais específica que qualquer outra.
    const regras = [regraDoClt(id), ...regrasAtuais];
    try {
      setSimulacao(
        await fetchApi<Simulacao>("/admin/acesso-app/simular", {
          method: "POST",
          token,
          body: JSON.stringify({ perfil: { id, capacidades, ativo: true }, regras }),
        }),
      );
      setRascunho({ id, regras });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card className="border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
      <p className="text-sm">
        <strong>O CLT que dirige</strong> entra hoje em <strong>{padrao.nome}</strong>, e ali tem{" "}
        {tira.map((c) => c.label.toLowerCase()).join(", ")}. Isso é pagamento de parceiro: não faz
        sentido pra quem recebe pela folha.
      </p>
      <Button className="mt-3" variant="outline" size="sm" onClick={ver}>
        Criar o grupo “{NOME}” sem esses itens
      </Button>
      {simulacao && rascunho && (
        <ConfirmarMudanca
          titulo={`Criar “${NOME}” pro CLT que dirige`}
          simulacao={simulacao}
          onCancelar={() => {
            setSimulacao(null);
            setRascunho(null);
          }}
          onConfirmar={async () => {
            try {
              const criado = await fetchApi<{ id: string }>("/admin/acesso-app/perfis", {
                method: "POST",
                token,
                body: JSON.stringify({
                  nome: NOME,
                  descricao: "O motorista registrado em carteira: dirige e lança, sem o que é pagamento de parceiro.",
                  capacidades,
                }),
              });
              await fetchApi("/admin/acesso-app/regras", {
                method: "PUT",
                token,
                body: JSON.stringify({ regras: [regraDoClt(criado.id), ...regrasAtuais] }),
              });
              toast.success(`Pronto: o CLT que dirige agora entra em “${NOME}”.`);
              setSimulacao(null);
              setRascunho(null);
              void qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      )}
    </Card>
  );
}
