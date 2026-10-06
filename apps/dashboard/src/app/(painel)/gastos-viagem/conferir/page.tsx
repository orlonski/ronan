"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, RotateCw, TriangleAlert } from "lucide-react";
import { AbasDaTela } from "@/components/abas-da-tela";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { MotoristaCombobox, ViagemCombobox } from "@/components/fk-comboboxes";
import { VisualizadorFotos, type FotoVisualizavel } from "@/components/visualizador-fotos";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LoadingCard } from "@/components/loading";
import { ApiError, fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { usePageTitle } from "@/lib/cabecalho";
import { cn } from "@/lib/utils";
import {
  brl,
  diaHora,
  diaSP,
  IconeTipo,
  rotuloStatus,
  textoDoPonto,
  useFotoBlob,
  type GastoPainel,
  type TipoDespesaPainel,
} from "../_components/comum";

/**
 * Gastos de viagem › Conferir (10-telas.md §10).
 *
 * Mestre-detalhe com a foto grande AO LADO do valor: quem confere olha os dois
 * juntos, dezenas de vezes seguidas, e trocar de tela ou abrir aba nova quebra
 * o ritmo (`feedback_imagem_nunca_em_aba_nova`). Sugestão só PREENCHE — quem
 * decide é gente, com motivo escrito quando o valor muda ou não se devolve.
 */
export default function ConferirGastosPage() {
  return (
    <RequerTela chave="conferencia-despesas.ver">
      <Conferir />
    </RequerTela>
  );
}

type Fila = { itens: GastoPainel[]; total: number; totalValor: string };

const ATALHOS_MOTIVO = [
  "Já veio no adiantamento",
  "Não é gasto de viagem",
  "Comprovante não é deste gasto",
];

function Conferir() {
  usePageTitle("Gastos de viagem");
  const token = useAuthToken();
  const qc = useQueryClient();
  const [motoristaId, setMotoristaId] = React.useState<string | undefined>();
  const [tipoId, setTipoId] = React.useState("");
  const [periodo, setPeriodo] = React.useState<"" | "hoje" | "7d" | "30d">("");
  const [soSemAtencao, setSoSemAtencao] = React.useState(false);
  const [selecionadoId, setSelecionadoId] = React.useState<string | null>(null);
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());
  const [confirmandoLote, setConfirmandoLote] = React.useState(false);

  const filtros = React.useMemo(() => {
    const p = new URLSearchParams();
    if (motoristaId) p.set("motoristaId", motoristaId);
    if (tipoId) p.set("tipoDespesaId", tipoId);
    if (soSemAtencao) p.set("semAtencao", "true");
    if (periodo) {
      const hoje = hojeSP();
      const dias = periodo === "hoje" ? 0 : periodo === "7d" ? 6 : 29;
      const de = new Date(`${hoje}T12:00:00Z`);
      de.setUTCDate(de.getUTCDate() - dias);
      p.set("de", de.toISOString().slice(0, 10));
      p.set("ate", hoje);
    }
    return p.toString();
  }, [motoristaId, tipoId, soSemAtencao, periodo]);

  const fila = useQuery({
    queryKey: ["gastos-fila", filtros],
    enabled: !!token,
    queryFn: () => fetchApi<Fila>(`/admin/despesas/conferir?${filtros}`, { token }),
  });
  const tipos = useQuery({
    queryKey: ["tipos-despesa"],
    enabled: !!token,
    staleTime: 60_000,
    queryFn: () => fetchApi<TipoDespesaPainel[]>("/admin/tipos-despesa", { token }),
  });

  const itens = fila.data?.itens ?? [];
  const elegiveis = itens.filter((i) => i.semAtencao);
  const idxSel = itens.findIndex((i) => i.id === selecionadoId);

  /** O detalhe aberto veio de um link ("ver" o repetido), não da fila. */
  const detalheForaDaFila = React.useRef(false);
  // Abre no primeiro da fila; se o selecionado saiu (decidido), vai pro que ocupou o lugar.
  React.useEffect(() => {
    if (!itens.length) return;
    if (!selecionadoId || (idxSel < 0 && !detalheForaDaFila.current)) setSelecionadoId(itens[0]!.id);
  }, [itens, selecionadoId, idxSel]);

  const mover = React.useCallback(
    (passo: number) => {
      if (!itens.length) return;
      const i = idxSel < 0 ? 0 : Math.min(Math.max(idxSel + passo, 0), itens.length - 1);
      detalheForaDaFila.current = false;
      setSelecionadoId(itens[i]!.id);
    },
    [itens, idxSel],
  );

  const recarregar = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["gastos-fila"] });
    void qc.invalidateQueries({ queryKey: ["gasto"] });
  }, [qc]);

  /** Depois de decidir: pula pro próximo (o que ocupar o lugar dele na fila). */
  const decidido = React.useCallback(
    (id: string) => {
      const prox = itens[idxSel + 1] ?? itens[idxSel - 1];
      setSelecionadoId(prox && prox.id !== id ? prox.id : null);
      setMarcados((m) => {
        const n = new Set(m);
        n.delete(id);
        return n;
      });
      recarregar();
      return prox;
    },
    [itens, idxSel, recarregar],
  );

  async function aprovarLote() {
    if (!token) return;
    try {
      const r = await fetchApi<{ aprovados: number; pulados: { id: string; motivo: string }[] }>(
        "/admin/despesas/aprovar-lote",
        { token, method: "POST", body: JSON.stringify({ ids: [...marcados] }) },
      );
      toast.success(
        r.pulados.length
          ? `${r.aprovados} aprovado(s). ${r.pulados.length} ficaram pra conferir um por um.`
          : `${r.aprovados} gasto(s) aprovado(s).`,
      );
      setMarcados(new Set());
      setConfirmandoLote(false);
      recarregar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const totalMarcado = itens.filter((i) => marcados.has(i.id)).reduce((s, i) => s + Number(i.valorInformado), 0);
  const filtrado = !!(motoristaId || tipoId || periodo || soSemAtencao);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Gastos de viagem</h1>
        <p className="text-sm text-muted-foreground">
          O que o motorista pagou na estrada. Aprovado entra sozinho no próximo acerto dele.
        </p>
      </div>
      <AbasDaTela grupo="gastos-viagem" />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <MotoristaCombobox value={motoristaId} onChange={setMotoristaId} placeholder="Motorista" />
        </div>
        <Select className="w-full sm:w-48" value={tipoId} onChange={(e) => setTipoId(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {(tipos.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </Select>
        <Select
          className="w-full sm:w-48"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value as typeof periodo)}
          aria-label="Período"
        >
          <option value="">Período: hoje e antes</option>
          <option value="hoje">Só hoje</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
        </Select>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={soSemAtencao} onChange={(e) => setSoSemAtencao(e.target.checked)} />
          Só sem ponto de atenção
        </label>
      </div>

      {/* Lote: só o que não tem ponto de atenção. Confirmação inline, na própria barra. */}
      <Permitido chave="conferencia-despesas.decidir">
        {elegiveis.length > 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
            {!confirmandoLote ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={marcados.size > 0 && marcados.size === elegiveis.length}
                    onChange={(e) => setMarcados(e.target.checked ? new Set(elegiveis.map((i) => i.id)) : new Set())}
                  />
                  Selecionar os {elegiveis.length} sem ponto de atenção
                </label>
                <Button
                  variant="success"
                  disabled={marcados.size === 0}
                  onClick={() => setConfirmandoLote(true)}
                >
                  <Check className="h-4 w-4" /> Aprovar {marcados.size} selecionado{marcados.size === 1 ? "" : "s"}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">
                  Aprovar {marcados.size} gasto{marcados.size === 1 ? "" : "s"}, {brl(totalMarcado)} no total?
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setConfirmandoLote(false)}>
                    Voltar
                  </Button>
                  <Button variant="success" onClick={() => void aprovarLote()}>
                    Aprovar {marcados.size} gasto{marcados.size === 1 ? "" : "s"}
                  </Button>
                </div>
              </>
            )}
          </Card>
        )}
      </Permitido>

      {fila.isLoading ? (
        <LoadingCard />
      ) : itens.length === 0 && !(selecionadoId && detalheForaDaFila.current) ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {filtrado ? (
            <>
              Nenhum gasto com esses filtros.{" "}
              <button
                className="text-primary underline"
                onClick={() => {
                  setMotoristaId(undefined);
                  setTipoId("");
                  setPeriodo("");
                  setSoSemAtencao(false);
                }}
              >
                Limpar filtros
              </button>
            </>
          ) : (
            <>
              Nada pra conferir. Os gastos novos aparecem aqui assim que o celular do motorista pegar sinal.{" "}
              <Link href="/gastos-viagem/todos" className="text-primary underline">
                Ver todos os gastos
              </Link>
            </>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <ListaDaFila
            itens={itens}
            selecionadoId={selecionadoId}
            onSelecionar={(id) => {
              detalheForaDaFila.current = false;
              setSelecionadoId(id);
            }}
            marcados={marcados}
            onMarcar={(id, v) =>
              setMarcados((m) => {
                const n = new Set(m);
                if (v) n.add(id);
                else n.delete(id);
                return n;
              })
            }
          />
          {selecionadoId ? (
            <Detalhe
              key={selecionadoId}
              id={selecionadoId}
              posicao={idxSel >= 0 ? `${idxSel + 1} de ${itens.length}` : null}
              onMover={mover}
              onDecidido={decidido}
              onAbrirOutro={(id) => {
                detalheForaDaFila.current = true;
                setSelecionadoId(id);
              }}
              onMudou={recarregar}
            />
          ) : (
            <Card className="p-8 text-center text-sm text-muted-foreground">Escolha um gasto na lista.</Card>
          )}
        </div>
      )}
    </div>
  );
}

function ListaDaFila({
  itens,
  selecionadoId,
  onSelecionar,
  marcados,
  onMarcar,
}: {
  itens: GastoPainel[];
  selecionadoId: string | null;
  onSelecionar: (id: string) => void;
  marcados: Set<string>;
  onMarcar: (id: string, v: boolean) => void;
}) {
  const hoje = hojeSP();
  const ontem = (() => {
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const grupos = new Map<string, GastoPainel[]>();
  for (const i of itens) {
    const dia = diaSP(i.data);
    grupos.set(dia, [...(grupos.get(dia) ?? []), i]);
  }
  const rotuloDia = (d: string) =>
    d === hoje ? "Hoje" : d === ontem ? "Ontem" : d.split("-").reverse().join("/");

  return (
    <Card className="max-h-[75vh] overflow-y-auto p-0">
      {[...grupos.entries()].map(([dia, lista]) => (
        <div key={dia}>
          <p className="sticky top-0 z-10 border-b bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {rotuloDia(dia)}
          </p>
          <ul className="divide-y">
            {lista.map((i) => (
              <li
                key={i.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 px-3 py-2.5 hover:bg-muted/50",
                  i.id === selecionadoId && "bg-sky-50 dark:bg-sky-950/40",
                )}
                onClick={() => onSelecionar(i.id)}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={!i.semAtencao}
                  title={i.semAtencao ? "Selecionar pra aprovar em lote" : "Tem ponto de atenção — confira um por um"}
                  checked={marcados.has(i.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onMarcar(i.id, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-muted-foreground">
                    {i.motorista.nome}
                    {i.veiculo ? ` · ${i.veiculo.placa}` : ""}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <IconeTipo icone={i.tipo.icone} className="h-6 w-6 text-sm" />
                    <span className="truncate">{i.tipo.nome}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums">{brl(i.valorInformado)}</p>
                  {i.pontos.length > 0 && (
                    <p className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-amber-700">
                      <TriangleAlert className="h-3 w-3" />
                      {i.pontos.length}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

function FotoGrande({ gasto, onAbrir, onGirou }: { gasto: GastoPainel; onAbrir: (i: number) => void; onGirou: () => void }) {
  const token = useAuthToken();
  const [i, setI] = React.useState(0);
  const foto = gasto.fotos[i];
  const blob = useFotoBlob(foto ? `/admin/despesas/${gasto.id}/fotos/${foto.id}` : undefined);

  async function girar() {
    if (!foto || !token) return;
    await fetchApi(`/admin/despesas/${gasto.id}/fotos/${foto.id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({ rotacao: (foto.rotacao + 90) % 360 }),
    });
    onGirou();
  }

  if (!foto) {
    return (
      <div className="flex h-64 items-center justify-center rounded-md border-2 border-dashed text-center text-sm text-muted-foreground lg:h-[480px]">
        {gasto.semComprovanteMotivo ? `Sem foto. Ele escreveu: "${gasto.semComprovanteMotivo}"` : "Sem foto do comprovante."}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="relative flex h-72 items-center justify-center overflow-hidden rounded-md bg-muted lg:h-[480px]">
        {blob.isError ? (
          <div className="text-center text-sm text-muted-foreground">
            Não deu pra abrir a foto.{" "}
            <Button variant="outline" size="sm" onClick={() => void blob.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : blob.data ? (
          <button type="button" className="h-full w-full" onClick={() => onAbrir(i)} title="Clique pra ampliar">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={blob.data}
              alt={`Comprovante de ${gasto.tipo.nome}`}
              className="mx-auto h-full w-full object-contain"
              style={{ transform: `rotate(${foto.rotacao}deg)` }}
            />
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">Carregando a foto…</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Permitido chave="conferencia-despesas.decidir">
          <Button variant="outline" size="sm" onClick={() => void girar()}>
            <RotateCw className="h-4 w-4" /> Girar
          </Button>
        </Permitido>
        <span className="text-xs text-muted-foreground">Clique na foto pra ampliar</span>
        {gasto.fotos.length > 1 && (
          <div className="ml-auto flex gap-1">
            {gasto.fotos.map((f, n) => (
              <Button key={f.id} size="sm" variant={n === i ? "default" : "outline"} onClick={() => setI(n)}>
                {n + 1}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Detalhe({
  id,
  posicao,
  onMover,
  onDecidido,
  onAbrirOutro,
  onMudou,
}: {
  id: string;
  posicao: string | null;
  onMover: (passo: number) => void;
  onDecidido: (id: string) => GastoPainel | undefined;
  onAbrirOutro: (id: string) => void;
  onMudou: () => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["gasto", id],
    enabled: !!token,
    queryFn: () => fetchApi<GastoPainel>(`/admin/despesas/${id}`, { token }),
  });
  const [modo, setModo] = React.useState<null | "outro-valor" | "nao-reembolsar">(null);
  const [valor, setValor] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [aviso, setAviso] = React.useState<string | null>(null);
  const [escolherViagem, setEscolherViagem] = React.useState(false);
  const [fotoAberta, setFotoAberta] = React.useState<number | null>(null);
  const [ocupado, setOcupado] = React.useState(false);

  const g = q.data;

  async function acao(caminho: string, body: unknown, sucesso: string) {
    if (!token || !g) return;
    setOcupado(true);
    setAviso(null);
    try {
      await fetchApi(`/admin/despesas/${g.id}/${caminho}`, { token, method: "POST", body: JSON.stringify(body) });
      const prox = onDecidido(g.id);
      const idDecidido = g.id;
      toast.success(
        prox ? `${sucesso} Próximo: ${prox.motorista.nome} · ${prox.tipo.nome}` : sucesso,
        {
          duration: 8000,
          action: {
            label: "Desfazer",
            onClick: () => {
              void fetchApi(`/admin/despesas/${idDecidido}/desfazer`, { token, method: "POST" }).then(() => {
                onMudou();
                onAbrirOutro(idDecidido);
              });
            },
          },
        },
      );
    } catch (e) {
      // "Alguém aprovou em outra aba": a fila atualiza e a faixa diz quem.
      if (e instanceof ApiError && e.status === 409) {
        setAviso(e.message);
        onMudou();
      } else toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function vincular(viagemId: string | null) {
    if (!token || !g) return;
    try {
      await fetchApi(`/admin/despesas/${g.id}/viagem`, { token, method: "PATCH", body: JSON.stringify({ viagemId }) });
      toast.success(viagemId ? "Gasto ligado à viagem." : "Gasto tirado da viagem.");
      setEscolherViagem(false);
      await qc.invalidateQueries({ queryKey: ["gasto", g.id] });
      onMudou();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Atalhos: A aprova · ↓ próximo · ↑ anterior · N não reembolsar.
  React.useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const alvo = ev.target as HTMLElement;
      if (alvo.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        onMover(1);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        onMover(-1);
      } else if ((ev.key === "a" || ev.key === "A") && g?.status === "COM_ESCRITORIO" && !modo) {
        void acao("aprovar", {}, "Aprovado.");
      } else if ((ev.key === "n" || ev.key === "N") && g?.status === "COM_ESCRITORIO") {
        setModo("nao-reembolsar");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (q.isLoading || !g) return <LoadingCard />;

  const status = rotuloStatus(g);
  const pendente = g.status === "COM_ESCRITORIO";
  const fotosVisualizaveis: FotoVisualizavel[] = g.fotos.map((f) => ({
    id: f.id,
    caminho: `/admin/despesas/${g.id}/fotos/${f.id}`,
    rotacao: f.rotacao,
  }));
  const diaG = diaSP(g.data);
  const umDia = (d: string, n: number) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const valorNum = Number(valor.replace(/\./g, "").replace(",", "."));
  const campos = g.camposDoTipo.campos;

  function abrirOutroValor(v?: string, m?: string) {
    setModo("outro-valor");
    setValor(v ? Number(v).toFixed(2).replace(".", ",") : "");
    setMotivo(m ?? "");
  }

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <VisualizadorFotos
        fotos={fotosVisualizaveis}
        indice={fotoAberta}
        onIndice={setFotoAberta}
        onFechar={() => setFotoAberta(null)}
        titulo={`${g.tipo.nome} · ${g.motorista.nome}`}
      />
      {aviso && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{aviso}</div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {g.tipo.nome} · {g.motorista.nome}
            {g.veiculo ? ` · ${g.veiculo.placa}` : ""}
          </h2>
          <p className="text-xs text-muted-foreground">
            {diaHora(g.data)} · lançado pelo app · chegou {diaHora(g.sincronizadoEm)}
            {!g.tipo.devolve && " · tipo que a empresa não devolve"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {posicao && <span className="mr-2 text-xs text-muted-foreground">{posicao}</span>}
          <Button variant="outline" size="icon" title="Anterior (↑)" onClick={() => onMover(-1)}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" title="Próximo (↓)" onClick={() => onMover(1)}>
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Na faixa MacBook compacto a foto vai pra cima dos dados (uma coluna). */}
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_260px]">
        <FotoGrande
          gasto={g}
          onAbrir={setFotoAberta}
          onGirou={() => void qc.invalidateQueries({ queryKey: ["gasto", g.id] })}
        />
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Lançado</dt>
            <dd className={cn("text-2xl font-bold tabular-nums", g.valorAprovado && Number(g.valorAprovado) !== Number(g.valorInformado) && "line-through decoration-1 opacity-60")}>
              {brl(g.valorInformado)}
            </dd>
            {g.valorAprovado && Number(g.valorAprovado) !== Number(g.valorInformado) && (
              <dd className="text-lg font-semibold tabular-nums text-amber-700">Aprovado {brl(g.valorAprovado)}</dd>
            )}
            <dd className="mt-1">
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", status.cor)}>{status.texto}</span>
              {g.decididoPor && g.decididoEm && (
                <span className="ml-1 text-xs text-muted-foreground">
                  por {g.decididoPor.nome} em {diaHora(g.decididoEm)}
                </span>
              )}
            </dd>
            {g.motivo && <dd className="mt-1 text-xs italic text-muted-foreground">&ldquo;{g.motivo}&rdquo;</dd>}
          </div>
          {g.descricao && (
            <div>
              <dt className="text-xs text-muted-foreground">{campos.descricao.pergunta ?? "O que foi feito"}</dt>
              <dd>&ldquo;{g.descricao}&rdquo;</dd>
            </div>
          )}
          {g.veiculo && (
            <div>
              <dt className="text-xs text-muted-foreground">Caminhão</dt>
              <dd>{g.veiculo.placa}</dd>
            </div>
          )}
          {g.odometro != null && (
            <div>
              <dt className="text-xs text-muted-foreground">Odômetro</dt>
              <dd className="tabular-nums">{g.odometro.toLocaleString("pt-BR")}</dd>
            </div>
          )}
          {g.litros && (
            <div>
              <dt className="text-xs text-muted-foreground">Litros</dt>
              <dd className="tabular-nums">{Number(g.litros).toLocaleString("pt-BR")}</dd>
            </div>
          )}
          {g.onde && (
            <div>
              <dt className="text-xs text-muted-foreground">Onde foi</dt>
              <dd>{g.onde}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">Viagem</dt>
            <dd>
              {g.viagem ? (
                <Link href={`/viagens/${g.viagem.id}`} className="text-primary hover:underline">
                  {g.viagem.resumo}
                </Link>
              ) : g.vinculo === "FORA_DE_VIAGEM" ? (
                "Ele disse que não foi em viagem"
              ) : g.viagemClientId ? (
                "Viagem ainda no celular dele"
              ) : (
                "Sem viagem"
              )}
            </dd>
          </div>
          {g.tipo.podeCobrarCliente && (
            <p className="text-xs text-muted-foreground">Tipo marcado como &ldquo;pode ser cobrado do cliente&rdquo;.</p>
          )}
        </dl>
      </div>

      {/* Sugestões: cada uma só PREENCHE. Ninguém decidiu ainda. */}
      {g.pontos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pontos de atenção (ninguém decidiu ainda)
          </p>
          <ul className="divide-y rounded-md border border-amber-200 bg-amber-50/60 text-sm dark:bg-amber-950/20">
            {g.pontos.map((p, n) => (
              <li key={n} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  {textoDoPonto(p)}
                  {p.tipo === "POSSIVEL_REPETIDO" && p.despesaId && (
                    <button className="ml-1 text-primary underline" onClick={() => onAbrirOutro(p.despesaId!)}>
                      ver
                    </button>
                  )}
                </span>
                <Permitido chave="conferencia-despesas.decidir">
                  {p.tipo === "ACIMA_DO_MAXIMO" && pendente && (
                    <Button variant="outline" size="sm" onClick={() => abrirOutroValor(p.maximo, `Acima do máximo do tipo (${brl(p.maximo)}).`)}>
                      Aprovar {brl(p.maximo)}
                    </Button>
                  )}
                  {p.tipo === "SEM_VIAGEM" && p.sugestao && (
                    <span className="flex items-center gap-2">
                      <Button size="sm" onClick={() => void vincular(p.sugestao!.viagemId)}>
                        Vincular a esta
                      </Button>
                      <button className="text-xs text-primary underline" onClick={() => setEscolherViagem(true)}>
                        Escolher outra
                      </button>
                    </span>
                  )}
                </Permitido>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Permitido chave="conferencia-despesas.decidir">
        {(escolherViagem || (!g.viagem && !g.pontos.some((p) => p.tipo === "SEM_VIAGEM"))) && !g.acerto?.status.match(/FECHADO|PAGO/) && (
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground">Ligar à viagem:</Label>
            <div className="w-full sm:w-80">
              <ViagemCombobox
                motoristaId={g.motorista.id}
                de={umDia(diaG, -1)}
                ate={umDia(diaG, 1)}
                value={undefined}
                onChange={(v) => v && void vincular(v)}
              />
            </div>
          </div>
        )}
        {g.viagem && !g.acerto?.status.match(/FECHADO|PAGO/) && (
          <button className="text-xs text-muted-foreground underline" onClick={() => void vincular(null)}>
            Tirar desta viagem
          </button>
        )}
      </Permitido>

      {g.doMes && (
        <p className="text-xs text-muted-foreground">
          Este mês do {g.motorista.nome.split(" ")[0]}: {g.doMes.quantidade} gasto{g.doMes.quantidade === 1 ? "" : "s"} ·{" "}
          {brl(g.doMes.total)}
          {g.doMes.naoReembolsados > 0 && ` · ${g.doMes.naoReembolsados} não reembolsado${g.doMes.naoReembolsados === 1 ? "" : "s"}`}
        </p>
      )}

      {g.acerto && (
        <p className="text-xs text-muted-foreground">
          No acerto de {g.acerto.periodoInicio.split("-").reverse().join("/")} a{" "}
          {g.acerto.periodoFim.split("-").reverse().join("/")} ({g.acerto.status.toLowerCase()}).
        </p>
      )}

      {/* Ações — semáforo: verde aprova; amarelo é cuidado (muda dinheiro de parceiro). */}
      <Permitido chave="conferencia-despesas.decidir">
        {pendente ? (
          <div className="space-y-3 border-t pt-3">
            {modo === "outro-valor" && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap gap-3">
                  <div className="w-40">
                    <Label htmlFor="valor-aprovado">Valor aprovado</Label>
                    <Input
                      id="valor-aprovado"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={valor}
                      onChange={(e) => setValor(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="min-w-[240px] flex-1">
                    <Label htmlFor="motivo-valor">Motivo (o motorista vai ler)</Label>
                    <Input id="motivo-valor" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setModo(null)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="success"
                    disabled={ocupado || !(valorNum >= 0) || !valor || !motivo.trim()}
                    onClick={() => void acao("aprovar", { valorAprovado: valorNum, motivo }, "Aprovado com outro valor.")}
                  >
                    Aprovar {valor ? brl(valorNum) : ""}
                  </Button>
                </div>
              </div>
            )}
            {modo === "nao-reembolsar" && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="motivo-nao">Motivo (o motorista vai ler)</Label>
                <Textarea id="motivo-nao" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
                <div className="flex flex-wrap gap-2">
                  {ATALHOS_MOTIVO.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
                      onClick={() => setMotivo(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setModo(null)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="warning"
                    disabled={ocupado || motivo.trim().length < 3}
                    onClick={() => void acao("nao-reembolsar", { motivo }, "Marcado como não reembolsado.")}
                  >
                    Não reembolsar
                  </Button>
                </div>
              </div>
            )}
            {!modo && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button variant="warning" onClick={() => { setMotivo(""); setModo("nao-reembolsar"); }}>
                    Não reembolsar
                  </Button>
                  <Button variant="warning" onClick={() => abrirOutroValor()}>
                    Aprovar outro valor
                  </Button>
                </div>
                <Button variant="success" disabled={ocupado} onClick={() => void acao("aprovar", {}, "Aprovado.")}>
                  <Check className="h-4 w-4" /> Aprovar
                </Button>
              </div>
            )}
            <p className="hidden text-xs text-muted-foreground lg:block">
              Atalhos: A aprova · ↓ próximo · ↑ anterior · N não reembolsar
            </p>
          </div>
        ) : (
          !g.acerto?.status.match(/FECHADO|PAGO/) && (
            <div className="border-t pt-3">
              <Button
                variant="outline"
                onClick={() =>
                  void fetchApi(`/admin/despesas/${g.id}/desfazer`, { token, method: "POST" }).then(() => {
                    onMudou();
                  })
                }
              >
                Voltar pra conferência
              </Button>
            </div>
          )
        )}
      </Permitido>
    </Card>
  );
}
