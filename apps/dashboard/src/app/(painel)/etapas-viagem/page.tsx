"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, FileText, Plus, Trash2 } from "lucide-react";
import {
  ETAPA_JANELA_DIAS_PADRAO,
  ETAPA_MAX_ARQUIVOS_POR_ITEM,
  itensDaDefinicao,
  lerDefinicaoEtapa,
  lerItemEtapa,
  MODELOS_ETAPA_PRONTOS,
  MOMENTO_ETAPA_LABEL,
  MOMENTOS_ETAPA,
  TIPO_ITEM_ETAPA_LABEL,
  TIPOS_ITEM_ETAPA,
  type DefinicaoEtapa,
  type DefinicaoEtapaInput,
  type ItemEtapa,
  type ItemEtapaInput,
  type ModeloEtapaPainel,
  type ModoExtraSimNao,
  type MomentoEtapa,
  type TipoEventoViagem,
  type TipoItemEtapa,
} from "@ronan/shared-types";
import { AbasDaTela } from "@/components/abas-da-tela";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { usePageTitle } from "@/lib/cabecalho";
import { cn } from "@/lib/utils";
import { PreviaCelularEtapa } from "./_components/previa-celular-etapa";

/**
 * Viagens › ⚙ Documentos da viagem (módulo `etapas`).
 *
 * A empresa monta os formulários de cada momento da viagem vendo ao lado como
 * fica no celular. Publicar grava uma versão NOVA (a anterior continua valendo
 * pras viagens que já começaram). Os modelos prontos do cliente de estrada
 * são OFERTA: só viram formulário quando a pessoa escolhe e publica.
 * Formulário nunca se apaga — desativa.
 */
export default function EtapasViagemPage() {
  return (
    <RequerTela chave="etapas-viagem.ver">
      <Etapas />
    </RequerTela>
  );
}

type Rascunho = {
  id: string | null;
  nome: string;
  momento: MomentoEtapa;
  tipoEventoId: string | null;
  janelaDias: number;
  ativo: boolean;
  definicao: DefinicaoEtapa;
};

const PATH = "/admin/etapas-modelos";

const novaChave = () => `i_${Math.random().toString(16).slice(2, 10)}`;

function itemNovo(tipo: TipoItemEtapa = "FOTO"): ItemEtapa {
  return lerItemEtapa({ chave: novaChave(), rotulo: "Novo item", tipo, obrigatorio: true })!;
}

const VAZIO: Rascunho = {
  id: null,
  nome: "",
  momento: "INICIO",
  tipoEventoId: null,
  janelaDias: ETAPA_JANELA_DIAS_PADRAO,
  ativo: true,
  definicao: { v: 1, areas: [{ titulo: "Documentos", itens: [itemNovo()] }] },
};

function deModelo(m: ModeloEtapaPainel): Rascunho {
  return {
    id: m.id,
    nome: m.nome,
    momento: m.momento,
    tipoEventoId: m.tipoEventoId,
    janelaDias: m.janelaDias,
    ativo: m.ativo,
    definicao: lerDefinicaoEtapa(m.definicao),
  };
}

function dePronto(p: (typeof MODELOS_ETAPA_PRONTOS)[number]): Rascunho {
  return {
    id: null,
    nome: p.nome,
    momento: p.momento,
    tipoEventoId: null,
    janelaDias: p.janelaDias,
    ativo: true,
    definicao: lerDefinicaoEtapa(p.definicao),
  };
}

const TEM_ARQUIVO: TipoItemEtapa[] = ["FOTO", "FOTO_OU_PDF", "TEXTO_COM_FOTO"];

/** Item resolvido → o que o Zod estrito do servidor aceita (só o que vale pro tipo). */
function paraInput(it: ItemEtapa): ItemEtapaInput {
  return {
    chave: it.chave,
    rotulo: it.rotulo.trim(),
    ...(it.ajuda?.trim() ? { ajuda: it.ajuda.trim() } : {}),
    tipo: it.tipo,
    obrigatorio: it.obrigatorio,
    seFaltar: it.obrigatorio ? it.seFaltar : "AVISAR",
    escritorioPodeAnexar: TEM_ARQUIVO.includes(it.tipo) ? it.escritorioPodeAnexar : false,
    ...(TEM_ARQUIVO.includes(it.tipo) || it.tipo === "SIM_NAO" ? { fotos: it.fotos } : {}),
    ...(it.tipo === "SIM_NAO" ? { simNao: it.simNao } : {}),
    ...(it.tipo === "VALOR" ? { valor: it.valor } : {}),
    ...(it.tipo === "NUMERO"
      ? { numero: { casas: it.numero.casas, ...(it.numero.unidade ? { unidade: it.numero.unidade } : {}) } }
      : {}),
    ...(it.tipo === "ASSINATURA" ? { assinatura: it.assinatura } : {}),
  };
}

function definicaoParaInput(d: DefinicaoEtapa): DefinicaoEtapaInput {
  return { v: 1, areas: d.areas.map((a) => ({ titulo: a.titulo.trim() || "Documentos", itens: a.itens.map(paraInput) })) };
}

function Etapas() {
  usePageTitle("Viagens");
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao } = usePermissoes();
  const podeEditar = temPermissao("etapas-viagem.editar");
  const podeCriar = temPermissao("etapas-viagem.criar");
  const modelos = useQuery({
    queryKey: ["etapas-modelos"],
    enabled: !!token,
    queryFn: () => fetchApi<ModeloEtapaPainel[]>(PATH, { token }),
  });
  const tiposEvento = useQuery({
    queryKey: ["tipos-evento-viagem-etapas"],
    enabled: !!token && temPermissao("tipos-evento-viagem.ver"),
    queryFn: () => fetchApi<TipoEventoViagem[]>("/admin/tipos-evento-viagem", { token }),
  });
  const paradas = (tiposEvento.data ?? []).filter((t) => t.ativo && !t.ehCarga && !t.ehDescarga);
  const lista = modelos.data ?? [];

  const [selId, setSelId] = React.useState<string | null>(null);
  const [rascunho, setRascunho] = React.useState<Rascunho | null>(null);
  const [original, setOriginal] = React.useState("");
  const [aberto, setAberto] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const [querTrocarPara, setQuerTrocarPara] = React.useState<{ id: string; r?: Rascunho } | null>(null);

  const sujo = rascunho != null && JSON.stringify(rascunho) !== original;

  const abrir = React.useCallback(
    (id: string, r?: Rascunho) => {
      setErro(null);
      setQuerTrocarPara(null);
      setAberto(null);
      setSelId(id);
      if (r) {
        setRascunho(r);
        setOriginal(id === "novo" ? "" : JSON.stringify(r));
        return;
      }
      const m = lista.find((x) => x.id === id);
      const novo = m ? deModelo(m) : null;
      setRascunho(novo);
      setOriginal(novo ? JSON.stringify(novo) : "");
    },
    [lista],
  );

  React.useEffect(() => {
    if (!selId && lista.length) abrir(lista[0]!.id);
  }, [lista, selId, abrir]);

  function pedirTroca(id: string, r?: Rascunho) {
    if (sujo) setQuerTrocarPara({ id, r });
    else abrir(id, r);
  }

  function mudar<K extends keyof Rascunho>(k: K, v: Rascunho[K]) {
    setRascunho((r) => (r ? { ...r, [k]: v } : r));
  }
  function mudarDef(fn: (d: DefinicaoEtapa) => DefinicaoEtapa) {
    setRascunho((r) => (r ? { ...r, definicao: fn(r.definicao) } : r));
  }
  function mudarItem(chave: string, patch: Partial<ItemEtapa>) {
    mudarDef((d) => ({
      ...d,
      areas: d.areas.map((a) => ({ ...a, itens: a.itens.map((it) => (it.chave === chave ? { ...it, ...patch } : it)) })),
    }));
  }
  function moverItem(ai: number, ii: number, passo: -1 | 1) {
    mudarDef((d) => {
      const areas = d.areas.map((a) => ({ ...a, itens: [...a.itens] }));
      const itens = areas[ai]!.itens;
      const j = ii + passo;
      if (j < 0 || j >= itens.length) return d;
      [itens[ii], itens[j]] = [itens[j]!, itens[ii]!];
      return { ...d, areas };
    });
  }
  function removerItem(ai: number, ii: number) {
    mudarDef((d) => ({
      ...d,
      areas: d.areas.map((a, i) => (i === ai ? { ...a, itens: a.itens.filter((_, k) => k !== ii) } : a)).filter((a) => a.itens.length > 0),
    }));
  }
  function moverArea(ai: number, passo: -1 | 1) {
    mudarDef((d) => {
      const areas = [...d.areas];
      const j = ai + passo;
      if (j < 0 || j >= areas.length) return d;
      [areas[ai], areas[j]] = [areas[j]!, areas[ai]!];
      return { ...d, areas };
    });
  }

  async function salvar() {
    if (!token || !rascunho) return;
    setErro(null);
    const itens = itensDaDefinicao(rascunho.definicao);
    if (rascunho.nome.trim().length < 2) return setErro("Dê um nome ao formulário.");
    if (!itens.length) return setErro("O formulário precisa de pelo menos um item.");
    if (itens.some((i) => !i.rotulo.trim())) return setErro("Todo item precisa do texto que o motorista lê.");
    if (rascunho.momento === "EVENTO" && !rascunho.tipoEventoId) return setErro("Escolha a parada em que o formulário aparece.");
    const body = {
      nome: rascunho.nome.trim(),
      momento: rascunho.momento,
      tipoEventoId: rascunho.momento === "EVENTO" ? rascunho.tipoEventoId : null,
      janelaDias: rascunho.janelaDias,
      ativo: rascunho.ativo,
      definicao: definicaoParaInput(rascunho.definicao),
    };
    setSalvando(true);
    try {
      const salvo = await fetchApi<ModeloEtapaPainel>(rascunho.id ? `${PATH}/${rascunho.id}` : PATH, {
        token,
        method: rascunho.id ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      toast.success(`${salvo.nome} publicado (versão ${salvo.versao}). Os celulares recebem na próxima conexão.`);
      const atual = await fetchApi<ModeloEtapaPainel[]>(PATH, { token });
      qc.setQueryData(["etapas-modelos"], atual);
      const r = deModelo(salvo);
      setSelId(salvo.id);
      setRascunho(r);
      setOriginal(JSON.stringify(r));
      if (querTrocarPara) abrir(querTrocarPara.id, querTrocarPara.r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo() {
    if (!token || !rascunho?.id) return;
    try {
      const salvo = await fetchApi<ModeloEtapaPainel>(`${PATH}/${rascunho.id}`, {
        token,
        method: "PATCH",
        body: JSON.stringify({
          nome: rascunho.nome.trim(),
          momento: rascunho.momento,
          tipoEventoId: rascunho.momento === "EVENTO" ? rascunho.tipoEventoId : null,
          janelaDias: rascunho.janelaDias,
          ativo: !rascunho.ativo,
          definicao: definicaoParaInput(lerDefinicaoEtapa(lista.find((m) => m.id === rascunho.id)?.definicao)),
        }),
      });
      toast.success(salvo.ativo ? "Formulário de volta no celular." : "Formulário desativado. O que já chegou continua na viagem.");
      const atual = await fetchApi<ModeloEtapaPainel[]>(PATH, { token });
      qc.setQueryData(["etapas-modelos"], atual);
      abrir(salvo.id, deModelo(salvo));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function moverModelo(id: string, passo: -1 | 1) {
    if (!token) return;
    const ids = lista.map((m) => m.id);
    const i = ids.indexOf(id);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const atual = await fetchApi<ModeloEtapaPainel[]>(`${PATH}/reordenar`, { token, method: "POST", body: JSON.stringify({ ids }) });
    qc.setQueryData(["etapas-modelos"], atual);
  }

  const somenteLeitura = rascunho?.id ? !podeEditar : !podeCriar;
  // Ofertas: os modelos prontos cujo nome a empresa ainda não usa.
  const ofertas = MODELOS_ETAPA_PRONTOS.filter(
    (p) => !lista.some((m) => m.nome.trim().toLowerCase() === p.nome.toLowerCase()),
  );

  if (modelos.isLoading) return <LoadingCard />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Viagens</h1>
        <p className="text-sm text-muted-foreground">
          Os documentos que o motorista manda pelo app em cada momento da viagem.
        </p>
      </div>
      <AbasDaTela grupo="viagens" />

      {lista.length === 0 && !rascunho && (
        <Card className="space-y-3 p-4 sm:p-5">
          <p className="font-medium">Nenhum formulário ainda.</p>
          <p className="text-sm text-muted-foreground">
            Comece pelos modelos prontos — carregamento, descarga e acerto do frete, do jeito que transportadora de
            estrada usa — e ajuste antes de publicar. Nada vai pro celular até você publicar, e mesmo publicado só
            aparece pra quem estiver com &ldquo;Documentos da viagem&rdquo; ligado em Permissões › App do motorista.
          </p>
        </Card>
      )}

      {podeCriar && ofertas.length > 0 && (
        <Card className="space-y-2 p-4">
          <p className="text-sm font-medium">Começar pelos modelos prontos</p>
          <div className="grid gap-2 md:grid-cols-3">
            {ofertas.map((p) => (
              <button
                key={p.nome}
                type="button"
                onClick={() => pedirTroca("novo", dePronto(p))}
                className="rounded-md border p-3 text-left hover:bg-muted"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4" /> {p.nome}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{MOMENTO_ETAPA_LABEL[p.momento]}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{p.descricao}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Abre no editor pra você conferir. Só vira formulário quando você publicar.</p>
        </Card>
      )}

      {/* Até 1535px a lista vira um Select acima do editor. */}
      {(lista.length > 0 || selId === "novo") && (
        <div className="2xl:hidden">
          <Label htmlFor="modelo-select">Formulário</Label>
          <Select id="modelo-select" value={selId ?? ""} onChange={(e) => pedirTroca(e.target.value)}>
            {lista.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
                {m.ativo ? "" : " (desativado)"}
              </option>
            ))}
            {selId === "novo" && <option value="novo">{rascunho?.nome || "Novo formulário"}</option>}
          </Select>
        </div>
      )}

      {(rascunho || lista.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <Card className="hidden space-y-2 p-3 2xl:block">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Formulários</p>
            {lista.map((m, i) => (
              <div key={m.id} className={cn("flex items-center rounded hover:bg-muted", selId === m.id && "bg-muted")}>
                <button className="min-w-0 flex-1 px-2 py-1.5 text-left text-sm" onClick={() => pedirTroca(m.id)}>
                  <span className={cn("block truncate", selId === m.id && "font-medium", !m.ativo && "text-muted-foreground")}>
                    {m.nome}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {m.ativo ? MOMENTO_ETAPA_LABEL[m.momento] : "Desativado"}
                  </span>
                </button>
                {podeEditar && (
                  <span className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Subir" disabled={i === 0} onClick={() => void moverModelo(m.id, -1)}>
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Descer" disabled={i === lista.length - 1} onClick={() => void moverModelo(m.id, 1)}>
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </span>
                )}
              </div>
            ))}
            {podeCriar && (
              <Button className="w-full" onClick={() => pedirTroca("novo", { ...VAZIO, definicao: { v: 1, areas: [{ titulo: "Documentos", itens: [itemNovo()] }] } })}>
                <Plus className="h-4 w-4" /> Novo formulário
              </Button>
            )}
          </Card>

          <Card className="space-y-5 p-4 sm:p-5">
            {querTrocarPara && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Você mudou {rascunho?.nome ? `“${rascunho.nome}”` : "o formulário"} e não publicou.
                <span className="flex gap-2">
                  <Button size="sm" variant="success" onClick={() => void salvar()} disabled={salvando}>
                    Publicar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => abrir(querTrocarPara.id, querTrocarPara.r)}>
                    Descartar mudanças
                  </Button>
                </span>
              </div>
            )}
            {!rascunho ? (
              <p className="text-sm text-muted-foreground">Escolha um formulário.</p>
            ) : (
              <fieldset disabled={somenteLeitura} className="space-y-5">
                {erro && <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="nome">Nome</Label>
                    <Input id="nome" value={rascunho.nome} maxLength={60} placeholder="Ex.: Carregamento" onChange={(e) => mudar("nome", e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="momento">Aparece no app</Label>
                    <Select id="momento" value={rascunho.momento} onChange={(e) => mudar("momento", e.target.value as MomentoEtapa)}>
                      {MOMENTOS_ETAPA.filter((m) => m !== "EVENTO" || paradas.length > 0 || rascunho.momento === "EVENTO").map((m) => (
                        <option key={m} value={m}>
                          {MOMENTO_ETAPA_LABEL[m]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {rascunho.momento === "EVENTO" && (
                    <div>
                      <Label htmlFor="parada">Em qual parada</Label>
                      <Select id="parada" value={rascunho.tipoEventoId ?? ""} onChange={(e) => mudar("tipoEventoId", e.target.value || null)}>
                        <option value="">Escolha…</option>
                        {paradas.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nome}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label htmlFor="janela">Dá pra mandar até</Label>
                    <Select id="janela" value={String(rascunho.janelaDias)} onChange={(e) => mudar("janelaDias", Number(e.target.value))}>
                      {[7, 15, 30, 45, 60, 90].map((d) => (
                        <option key={d} value={d}>
                          {d} dias depois de finalizar
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">Canhoto e acerto às vezes demoram semanas.</p>
                  </div>
                </div>

                {rascunho.definicao.areas.map((a, ai) => (
                  <section key={ai} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label="Nome da área"
                        className="font-semibold"
                        value={a.titulo}
                        maxLength={80}
                        onChange={(e) =>
                          mudarDef((d) => ({ ...d, areas: d.areas.map((x, i) => (i === ai ? { ...x, titulo: e.target.value } : x)) }))
                        }
                      />
                      <Button variant="ghost" size="icon" title="Subir área" disabled={ai === 0} onClick={() => moverArea(ai, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Descer área" disabled={ai === rascunho.definicao.areas.length - 1} onClick={() => moverArea(ai, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                    <ul className="space-y-1">
                      {a.itens.map((it, ii) => (
                        <li key={it.chave} className="rounded border">
                          <div className="flex items-center gap-2 px-2 py-1.5">
                            <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => setAberto(aberto === it.chave ? null : it.chave)}>
                              <span className="block truncate font-medium">{it.rotulo || "(sem texto)"}</span>
                              <span className="block text-xs text-muted-foreground">
                                {TIPO_ITEM_ETAPA_LABEL[it.tipo]}
                                {it.obrigatorio ? " · obrigatório" : " · opcional"}
                                {it.seFaltar === "NAO_SEGUIR" ? " · pede motivo pra seguir" : ""}
                                {it.escritorioPodeAnexar ? " · escritório também anexa" : ""}
                              </span>
                            </button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Subir" disabled={ii === 0} onClick={() => moverItem(ai, ii, -1)}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Descer" disabled={ii === a.itens.length - 1} onClick={() => moverItem(ai, ii, 1)}>
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-700" title="Tirar item" onClick={() => removerItem(ai, ii)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {aberto === it.chave && <EditorItem item={it} onMudar={(p) => mudarItem(it.chave, p)} />}
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const n = itemNovo();
                        mudarDef((d) => ({ ...d, areas: d.areas.map((x, i) => (i === ai ? { ...x, itens: [...x.itens, n] } : x)) }));
                        setAberto(n.chave);
                      }}
                    >
                      <Plus className="h-4 w-4" /> Adicionar item
                    </Button>
                  </section>
                ))}
                <Button
                  variant="outline"
                  onClick={() => {
                    const n = itemNovo();
                    mudarDef((d) => ({ ...d, areas: [...d.areas, { titulo: "Nova área", itens: [n] }] }));
                    setAberto(n.chave);
                  }}
                >
                  <Plus className="h-4 w-4" /> Adicionar área
                </Button>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                  {rascunho.id && podeEditar ? (
                    <Button type="button" variant={rascunho.ativo ? "warning" : "outline"} onClick={() => void alternarAtivo()}>
                      {rascunho.ativo ? "Desativar formulário" : "Ligar de novo"}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <span className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!sujo}
                      onClick={() => (rascunho.id ? abrir(rascunho.id) : lista[0] ? abrir(lista[0].id) : (setRascunho(null), setSelId(null)))}
                    >
                      Cancelar
                    </Button>
                    <Button type="button" variant="success" disabled={!sujo || salvando} onClick={() => void salvar()}>
                      Publicar
                    </Button>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Publicar cria uma versão nova: viagem que já começou segue com a versão que o motorista viu. Desativar
                  tira o formulário do celular; o que já chegou continua na viagem.
                </p>
              </fieldset>
            )}
          </Card>

          <div className="space-y-2 max-lg:order-last">
            {rascunho && (
              <PreviaCelularEtapa nome={rascunho.nome} momento={rascunho.momento} definicao={rascunho.definicao} pendente={sujo} />
            )}
          </div>
        </div>
      )}

      {podeCriar && (
        <div className="2xl:hidden">
          <Button onClick={() => pedirTroca("novo", { ...VAZIO, definicao: { v: 1, areas: [{ titulo: "Documentos", itens: [itemNovo()] }] } })}>
            <Plus className="h-4 w-4" /> Novo formulário
          </Button>
        </div>
      )}
    </div>
  );
}

const MODOS_EXTRA: { v: ModoExtraSimNao; label: string }[] = [
  { v: "NAO", label: "Nada" },
  { v: "PEDE", label: "Pede (opcional)" },
  { v: "EXIGE", label: "Exige" },
];

/** O painel do item, aberto debaixo da linha (nunca pop-up empilhado). */
function EditorItem({ item, onMudar }: { item: ItemEtapa; onMudar: (p: Partial<ItemEtapa>) => void }) {
  const temArquivo = TEM_ARQUIVO.includes(item.tipo);
  return (
    <div className="space-y-3 border-t bg-muted/30 p-3">
      <Linha label="Texto que o motorista lê">
        <Input value={item.rotulo} maxLength={120} onChange={(e) => onMudar({ rotulo: e.target.value })} />
      </Linha>
      <Linha label="Tipo">
        <Select
          value={item.tipo}
          onChange={(e) => {
            const tipo = e.target.value as TipoItemEtapa;
            const base = lerItemEtapa({ chave: item.chave, rotulo: item.rotulo, tipo, obrigatorio: item.obrigatorio })!;
            onMudar({ tipo, fotos: base.fotos, escritorioPodeAnexar: TEM_ARQUIVO.includes(tipo) ? item.escritorioPodeAnexar : false });
          }}
        >
          {TIPOS_ITEM_ETAPA.map((t) => (
            <option key={t} value={t}>
              {TIPO_ITEM_ETAPA_LABEL[t]}
            </option>
          ))}
        </Select>
      </Linha>
      <Linha label="Obrigatório">
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={item.obrigatorio}
            onChange={(e) => onMudar({ obrigatorio: e.target.checked, ...(e.target.checked ? {} : { seFaltar: "AVISAR" }) })}
          />
          Sem ele, aparece como documento faltando na viagem
        </label>
      </Linha>
      {item.obrigatorio && (
        <Linha
          label="Se faltar"
          ajuda={
            item.seFaltar === "NAO_SEGUIR"
              ? "Na próxima ação, o app para um instante e oferece anexar ou seguir dizendo o motivo. Nunca trava."
              : undefined
          }
        >
          <Select value={item.seFaltar} onChange={(e) => onMudar({ seFaltar: e.target.value as ItemEtapa["seFaltar"] })}>
            <option value="AVISAR">Só avisar o escritório</option>
            <option value="NAO_SEGUIR">Pedir motivo pra seguir (não seguir viagem sem este)</option>
          </Select>
        </Linha>
      )}
      <Linha label="Ajuda pro motorista">
        <Input value={item.ajuda ?? ""} maxLength={200} placeholder="(opcional) uma linha" onChange={(e) => onMudar({ ajuda: e.target.value })} />
      </Linha>
      {(temArquivo || item.tipo === "SIM_NAO") && (
        <Linha label="Quantos arquivos">
          <div className="flex items-center gap-2 text-sm">
            {item.tipo !== "SIM_NAO" && (
              <>
                no mínimo
                <Select
                  className="w-20"
                  value={String(Math.max(1, item.fotos.min))}
                  onChange={(e) => onMudar({ fotos: { min: Number(e.target.value), max: Math.max(Number(e.target.value), item.fotos.max) } })}
                >
                  {Array.from({ length: ETAPA_MAX_ARQUIVOS_POR_ITEM }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </>
            )}
            até
            <Select
              className="w-20"
              value={String(item.fotos.max)}
              onChange={(e) => onMudar({ fotos: { min: Math.min(item.fotos.min, Number(e.target.value)), max: Number(e.target.value) } })}
            >
              {Array.from({ length: ETAPA_MAX_ARQUIVOS_POR_ITEM }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </Linha>
      )}
      {temArquivo && (
        <Linha label="Escritório também anexa" ajuda="Pro documento que nasce no escritório (ex.: comprovante de encerramento do MDF-e).">
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={item.escritorioPodeAnexar} onChange={(e) => onMudar({ escritorioPodeAnexar: e.target.checked })} />
            Mostrar &ldquo;Anexar pelo escritório&rdquo; na viagem
          </label>
        </Linha>
      )}
      {item.tipo === "SIM_NAO" &&
        (["aoSim", "aoNao"] as const).map((lado) => (
          <Linha key={lado} label={lado === "aoSim" ? "Ao responder Sim, pedir" : "Ao responder Não, pedir"}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                aria-label="Foto"
                value={item.simNao[lado].foto}
                onChange={(e) => onMudar({ simNao: { ...item.simNao, [lado]: { ...item.simNao[lado], foto: e.target.value as ModoExtraSimNao } } })}
              >
                {MODOS_EXTRA.map((m) => (
                  <option key={m.v} value={m.v}>
                    Foto: {m.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Comentário"
                value={item.simNao[lado].comentario}
                onChange={(e) =>
                  onMudar({ simNao: { ...item.simNao, [lado]: { ...item.simNao[lado], comentario: e.target.value as ModoExtraSimNao } } })
                }
              >
                {MODOS_EXTRA.map((m) => (
                  <option key={m.v} value={m.v}>
                    Comentário: {m.label}
                  </option>
                ))}
              </Select>
            </div>
          </Linha>
        ))}
      {item.tipo === "VALOR" && (
        <Linha label="Comparar com a tabela" ajuda="Mostra na viagem se o valor por tonelada informado é diferente da tabela de preço. Nunca muda o valor da viagem.">
          <label className="flex h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={item.valor.comparaTabelaPorTonelada}
              onChange={(e) => onMudar({ valor: { comparaTabelaPorTonelada: e.target.checked } })}
            />
            É a tarifa por tonelada
          </label>
        </Linha>
      )}
      {item.tipo === "NUMERO" && (
        <Linha label="Unidade e casas">
          <div className="flex gap-2">
            <Input
              className="w-28"
              placeholder="km, kg…"
              maxLength={12}
              value={item.numero.unidade ?? ""}
              onChange={(e) => onMudar({ numero: { ...item.numero, unidade: e.target.value || null } })}
            />
            <Select className="w-32" value={String(item.numero.casas)} onChange={(e) => onMudar({ numero: { ...item.numero, casas: Number(e.target.value) } })}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n} casas
                </option>
              ))}
            </Select>
          </div>
        </Linha>
      )}
      {item.tipo === "ASSINATURA" && (
        <Linha label="Nome de quem assina">
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={item.assinatura.pedeNome} onChange={(e) => onMudar({ assinatura: { pedeNome: e.target.checked } })} />
            Pedir o nome junto da assinatura
          </label>
        </Linha>
      )}
    </div>
  );
}

function Linha({ label, ajuda, children }: { label: string; ajuda?: string; children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-1 sm:grid-cols-[172px_minmax(0,1fr)] sm:gap-2">
      <Label className="pt-2.5">{label}</Label>
      <div>
        {children}
        {ajuda && <p className="mt-1 text-xs text-muted-foreground">{ajuda}</p>}
      </div>
    </div>
  );
}
