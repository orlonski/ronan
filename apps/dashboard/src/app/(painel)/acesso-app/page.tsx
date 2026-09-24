"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Coins, Save, ShieldAlert, Smartphone, Users2 } from "lucide-react";
import { toast } from "sonner";
import {
  CAPACIDADES_APP,
  CAPACIDADE_POR_CHAVE,
  GRUPOS_CAPACIDADE_APP,
  type CapacidadeApp,
  type CapacidadeAppDef,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AbasPermissoes } from "@/components/abas-permissoes";
import { AppPreview } from "@/components/app-preview";
import { LoadingCard } from "@/components/loading";
import { ErroCard } from "@/components/erro-estado";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import { PessoasDiferentes } from "./_components/excecoes";
import { AbaPlataforma } from "./_components/plataforma";
import { ConfirmarMudanca } from "./_components/simulacao";
import { DO_ACESSO_APP, type ColunaApp, type PainelAcessoApp, type Simulacao } from "./_components/tipos";


/**
 * PERMISSÕES DO APP — a outra metade de "Papéis e permissões".
 *
 * ⚠️ Mesmo desenho da tela de papéis do painel, de propósito: à esquerda os
 * TIPOS (como os papéis), à direita as caixinhas do que aquele tipo vê no
 * celular. O dono pediu isto depois de dizer que a versão anterior (grupos,
 * regras, exceções, travas, sombra, tudo à mostra) era impossível de entender.
 *
 * O TIPO É A MODALIDADE DO MOTORISTA (decisão do dono): Autônomo (TAC),
 * Agregado, Empregado CLT... — cadastradas pela empresa em Vínculos do
 * motorista, nunca no código. Mais dois fixos: "sem modalidade" e "só bate
 * ponto" (CLT sem cadastro de motorista). O que cada tipo vê é dado.
 */
export default function PermissoesDoAppPage() {
  return (
    <RequerTela chave="perfis-acesso.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const painel = useApiQuery<PainelAcessoApp>("/admin/acesso-app");
  const [chave, setChave] = useState("SEM_MODALIDADE");

  if (painel.isLoading) return <LoadingCard />;
  if (painel.error || !painel.data) {
    return <ErroCard erro={painel.error} onRetry={() => painel.refetch()} />;
  }
  const p = painel.data;
  const coluna = p.colunas.find((c) => c.chave === chave) ?? p.colunas[0]!;
  const semModalidades = p.colunas.length <= 2;

  return (
    <div className="space-y-6">
      <AbasPermissoes />
      <div>
        <h1 className="text-2xl font-bold">Permissões do app</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O que cada modalidade de motorista vê no celular. Marque e salve, como nos papéis do painel.
        </p>
      </div>

      {p.fonte !== "REGRAS" && <PassarParaTabela />}
      {!!p.espelho.divergencias && (
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="text-sm">
            Não conseguimos montar a tabela a partir das fichas de {p.espelho.divergencias} pessoa(s),
            e <strong>nada foi alterado</strong>. É defeito nosso: avise o suporte.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {p.colunas.map((c) => (
            <button
              key={c.chave}
              type="button"
              onClick={() => setChave(c.chave)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-md border p-3 text-left transition-colors",
                coluna.chave === c.chave ? "border-primary bg-primary/5" : "hover:bg-muted",
              )}
            >
              <span className="text-sm font-medium">{c.nome}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users2 className="h-3 w-3" />
                {c.pessoas === 1 ? "1 pessoa" : `${c.pessoas} pessoas`} ·{" "}
                {c.herda ? "igual a Sem modalidade" : `${c.capacidades.length} itens no app`}
              </span>
            </button>
          ))}
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">De onde vem o tipo?</p>
            <p>
              Da <strong className="text-foreground">modalidade</strong> na ficha do motorista. Quem não
              tem cadastro de motorista e está em Quem bate ponto é <strong className="text-foreground">Só bate ponto</strong>.
            </p>
            {semModalidades ? (
              <p className="mt-2">
                Esta empresa ainda não tem modalidades. Cadastre em{" "}
                <Link href="/modalidades" className="underline">
                  Motoristas › Modalidades
                </Link>{" "}
                (por exemplo: Autônomo (TAC), Agregado, Empregado CLT) e cada uma aparece aqui.
              </p>
            ) : (
              <p className="mt-2">
                As modalidades ficam em{" "}
                <Link href="/modalidades" className="underline">
                  Motoristas › Modalidades
                </Link>
                .
              </p>
            )}
          </div>
        </div>

        <EditorDoTipo key={`${coluna.chave}-${p.versao}`} painel={p} coluna={coluna} />
      </div>

      <PessoasDiferentes painel={p} />
      {p.plataforma && <ControlesDaPlataforma painel={p} />}
    </div>
  );
}

/** Por que este item não vale pra este tipo, se não vale. */
function motivoIndisponivel(def: CapacidadeAppDef, chave: string): string | null {
  if (def.vinculo === "MOTORISTA" && chave === "SO_PONTO") return "precisa ter cadastro de motorista";
  return null;
}

/** Aviso ao lado do item, quando ele só vale pra parte das pessoas do tipo. */
function avisoDoItem(def: CapacidadeAppDef, chave: string): string | null {
  if (def.vinculo === "FUNCIONARIO" && chave !== "SO_PONTO") return "só vale pra quem também está em Quem bate ponto";
  return null;
}

function EditorDoTipo({ painel, coluna }: { painel: PainelAcessoApp; coluna: ColunaApp }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  // O selo "custa" é conta da Movatruck, não do cliente: quem paga a IA é a
  // plataforma, e valor não aparece pra empresa (pedido do dono, 23/09/2026).
  const { temPermissao, plataforma } = usePermissoes();
  const podeEditar = painel.fonte === "REGRAS" && temPermissao("perfis-acesso.editar");
  const inicial = useMemo(() => new Set(coluna.capacidades as CapacidadeApp[]), [coluna]);
  const [marcadas, setMarcadas] = useState<Set<CapacidadeApp>>(inicial);
  // "Valer pra todos": item que não mudou, mas que o escritório quer que
  // valha pro grupo inteiro — derruba a diferença herdada da ficha antiga.
  const [valer, setValer] = useState<Set<CapacidadeApp>>(new Set());
  const [vendo, setVendo] = useState(false);
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    setMarcadas(inicial);
    setValer(new Set());
  }, [inicial]);

  // Ferramenta da plataforma (gravar o uso da tela) não é da empresa marcar.
  const itens = CAPACIDADES_APP.filter((c) => c.tipo !== "PLATAFORMA");
  const alterado =
    valer.size > 0 || marcadas.size !== inicial.size || [...marcadas].some((c) => !inicial.has(c));
  const custa = plataforma && itens.some((c) => c.custa && marcadas.has(c.chave));
  const nomeTipo = coluna.nome;
  const tipo = coluna.chave;

  function alternar(c: CapacidadeApp) {
    setMarcadas((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  }

  // Só a coluna que está na tela: as outras ficam como estão.
  const corpoTabela = () => ({
    colunas: [{ chave: coluna.chave, capacidades: [...marcadas], valerPraTodos: [...valer] }],
  });

  /** Quantas pessoas do grupo estão diferentes deste item por causa da ficha antiga. */
  function diferentes(c: CapacidadeApp): number {
    const h = coluna.herdadas?.[c];
    if (!h) return 0;
    return marcadas.has(c) ? h.naoVeem : h.tambemVeem;
  }

  async function salvar() {
    setOcupado(true);
    try {
      const s = await fetchApi<Simulacao>("/admin/acesso-app/tabela/simular", {
        method: "POST",
        token,
        body: JSON.stringify(corpoTabela()),
      });
      // Ninguém perde nada: salva direto. Alguém perde, ou alguma diferença
      // da ficha antiga cai: mostra quem, antes.
      if (s.herdadas || s.mudam.some((m) => m.perdeu.length > 0)) setSimulacao(s);
      else await gravar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function gravar() {
    await fetchApi("/admin/acesso-app/tabela", { method: "PUT", token, body: JSON.stringify(corpoTabela()) });
    toast.success("Salvo. Chega no celular de cada um na próxima vez que abrir o app com sinal.");
    setSimulacao(null);
    void qc.invalidateQueries(DO_ACESSO_APP);
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{nomeTipo}</h2>
          <p className="text-sm text-muted-foreground">
            {coluna.quem} {coluna.pessoas === 1 ? "1 pessoa." : `${coluna.pessoas} pessoas.`}
          </p>
          {coluna.herda && (
            <p className="mt-1 text-xs text-muted-foreground">
              Ainda igual a “Sem modalidade”. Salvando, esta modalidade passa a ter a configuração dela.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setVendo(true)}>
          <Smartphone className="mr-2 h-4 w-4" />
          Ver o celular
        </Button>
      </div>

      <div className="space-y-4">
        {GRUPOS_CAPACIDADE_APP.map((grupo) => {
          const doGrupo = itens.filter((c) => c.grupo === grupo);
          if (!doGrupo.length) return null;
          const disponiveis = doGrupo.filter((c) => !motivoIndisponivel(c, tipo));
          const marcadosNoGrupo = disponiveis.filter((c) => marcadas.has(c.chave)).length;
          const todos = disponiveis.length > 0 && marcadosNoGrupo === disponiveis.length;
          return (
            <div key={grupo} className="rounded-lg border">
              <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
                <span className="text-sm font-semibold">
                  {grupo}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({marcadosNoGrupo}/{disponiveis.length})
                  </span>
                </span>
                {podeEditar && disponiveis.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setMarcadas((prev) => {
                        const n = new Set(prev);
                        for (const c of disponiveis) {
                          if (todos) n.delete(c.chave);
                          else n.add(c.chave);
                        }
                        return n;
                      })
                    }
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {todos ? "Desmarcar todos" : "Marcar todos"}
                  </button>
                )}
              </div>
              <div className="divide-y">
                {doGrupo.map((c) => {
                  const indisponivel = motivoIndisponivel(c, tipo);
                  const aviso = avisoDoItem(c, tipo);
                  const mudou = marcadas.has(c.chave) !== inicial.has(c.chave);
                  const nDiferentes = indisponivel ? 0 : diferentes(c.chave);
                  return (
                    <label
                      key={c.chave}
                      className={cn(
                        "flex items-start gap-3 p-3",
                        podeEditar && !indisponivel ? "cursor-pointer hover:bg-muted/40" : "cursor-default",
                        indisponivel && "opacity-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-input"
                        checked={!indisponivel && marcadas.has(c.chave)}
                        disabled={!podeEditar || !!indisponivel}
                        onChange={() => alternar(c.chave)}
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {c.label}
                          {plataforma && c.custa && (
                            <span
                              title="Cada uso tem custo e entra na conta"
                              className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700"
                            >
                              <Coins className="h-3 w-3" />
                              custa
                            </span>
                          )}
                          {(indisponivel || aviso) && (
                            <span className="text-xs font-normal text-muted-foreground">({indisponivel ?? aviso})</span>
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">{c.efeito}</span>
                        {nDiferentes > 0 && (
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                            {mudou || valer.has(c.chave) ? (
                              <>Salvando, vale pra todos deste tipo — inclusive {nDiferentes === 1 ? "1 pessoa" : `${nDiferentes} pessoas`} que a ficha antiga deixava diferente.</>
                            ) : (
                              <>
                                {nDiferentes === 1 ? "1 pessoa" : `${nDiferentes} pessoas`} deste tipo{" "}
                                {marcadas.has(c.chave) ? "não veem" : "também veem"} isto, por causa da ficha antiga.
                              </>
                            )}
                            {podeEditar && !mudou && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setValer((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(c.chave)) n.delete(c.chave);
                                    else n.add(c.chave);
                                    return n;
                                  });
                                }}
                                className="font-medium text-blue-600 hover:underline"
                              >
                                {valer.has(c.chave) ? "Desfazer" : "Valer pra todos"}
                              </button>
                            )}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {custa && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <Coins className="mt-0.5 h-4 w-4 shrink-0" />
          Tem item que custa por uso marcado: todo mundo deste tipo passa a consumir.
        </p>
      )}

      {podeEditar && (
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          {alterado && (
            <Button
              variant="outline"
              onClick={() => {
                setMarcadas(inicial);
                setValer(new Set());
              }}
            >
              Desfazer
            </Button>
          )}
          <Button onClick={salvar} disabled={!alterado || ocupado}>
            <Save className="mr-1 h-4 w-4" />
            {ocupado ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      )}

      {vendo && (
        <Dialog open onOpenChange={(o) => !o && setVendo(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>O celular: {nomeTipo}</DialogTitle>
            </DialogHeader>
            <AppPreview capacidades={[...marcadas]} />
          </DialogContent>
        </Dialog>
      )}
      {simulacao && (
        <ConfirmarMudanca
          titulo={`Salvar ${nomeTipo}`}
          simulacao={simulacao}
          onCancelar={() => setSimulacao(null)}
          onConfirmar={async () => {
            try {
              await gravar();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      )}
    </Card>
  );
}

/**
 * Empresa que ainda liga os acessos na ficha de cada motorista: a tabela
 * mostra o que essas fichas já formam, e oferece passar a configurar aqui.
 */
function PassarParaTabela() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [confirmando, setConfirmando] = useState(false);
  const [passando, setPassando] = useState(false);

  return (
    <Card className="border-blue-300 bg-blue-50/60 p-5 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl space-y-1 text-sm">
          <p className="font-semibold">Hoje os acessos são ligados motorista por motorista, na ficha de cada um.</p>
          <p className="text-muted-foreground">
            A tabela abaixo mostra o que essas fichas já dão a cada tipo. Configurando por aqui,
            quem entra novo já recebe o certo. <strong className="text-foreground">Ninguém perde nada na troca.</strong>
          </p>
        </div>
        <Permitido chave="perfis-acesso.editar">
          <Button onClick={() => setConfirmando(true)}>Configurar por aqui</Button>
        </Permitido>
      </div>
      {confirmando && (
        <Dialog open onOpenChange={(o) => !o && setConfirmando(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Configurar o app por aqui</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <p>Cada pessoa continua vendo exatamente o que vê hoje. A gente confere antes; se algo não bater, não muda nada.</p>
              <p>Depois disso, as chavinhas saem da ficha do motorista. Pra mudar uma pessoa só, use “Dar ou tirar algo só dele” na ficha dela.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmando(false)}>
                Agora não
              </Button>
              <Button
                variant="success"
                disabled={passando}
                onClick={async () => {
                  setPassando(true);
                  try {
                    await fetchApi("/admin/acesso-app/passar-para-regras", { method: "POST", token });
                    toast.success("Pronto. O app agora é configurado por aqui.");
                    setConfirmando(false);
                    void qc.invalidateQueries(DO_ACESSO_APP);
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setPassando(false);
                  }
                }}
              >
                {passando ? "Conferindo…" : "Configurar por aqui"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

/** Só a plataforma vê: travas, o que ainda não corta, liberações. Recolhido. */
function ControlesDaPlataforma({ painel }: { painel: PainelAcessoApp }) {
  const [aberto, setAberto] = useState(false);
  const total = painel.sombra.reduce((s, x) => s + x.pessoas, 0);
  return (
    <section className="border-t border-border pt-6">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        onClick={() => setAberto((v) => !v)}
      >
        {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Controles da plataforma (só você vê)
      </button>
      {aberto && (
        <div className="mt-4 space-y-4">
          {total > 0 && (
            <Card className="p-4 text-sm">
              <p className="font-medium">{total} acesso(s) que cortariam se as travas fossem ligadas:</p>
              <ul className="mt-2 space-y-0.5 pl-4 text-muted-foreground">
                {painel.sombra.map((s) => (
                  <li key={s.capacidade}>
                    {CAPACIDADE_POR_CHAVE[s.capacidade as CapacidadeApp]?.label ?? s.capacidade}: {s.pessoas} pessoa(s)
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <AbaPlataforma key={painel.versao} painel={painel} />
        </div>
      )}
    </section>
  );
}
