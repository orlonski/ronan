"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, FileText, XCircle } from "lucide-react";
import { RESPOSTA_CARGA_TAG_ROTULO, type RespostaCargaTag } from "@ronan/shared-types";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingCard } from "@/components/loading";
import { apiBaseUrl, fetchApi, useAuthToken } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { brl, dia, diaSP, type Achado, type PassagemTela, type RaioX } from "./tipos";

/**
 * O raio-x de UMA fatura, pela ordem do dinheiro (03-proposta, decisão a):
 * "Pode ser seu" (vale-pedágio que não veio, sempre "até" enquanto gente não
 * confirma), "Pra conferir e contestar até dd/mm" e "Pra conversar". Cada
 * passagem está em uma caixa só — o servidor garante (04-qa B2).
 */
export function RaioXFatura({ extratoId, onCasar }: { extratoId: string; onCasar: (placa: string) => void }) {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["tag", "raio-x", extratoId],
    enabled: Boolean(token),
    queryFn: () => fetchApi<RaioX>(`/admin/tag-pedagio/extratos/${extratoId}/raio-x`, { token: token! }),
  });
  const [aberta, setAberta] = React.useState<"seu" | "contestar" | "conversar" | null>(null);
  const [vendoPdf, setVendoPdf] = React.useState(false);
  if (q.isLoading) return <LoadingCard />;
  if (q.error) return <Card className="border-l-4 border-l-red-500 p-4 text-sm">{(q.error as Error).message}</Card>;
  const r = q.data!;
  const e = r.extrato;
  const conferencias = e.checagens.filter((c) => c.ok).length;
  const semCadastro = e.placas.filter((p) => !p.cadastrada);
  const terceiros = e.placas.filter((p) => p.terceiro);

  return (
    <div className="space-y-4 max-2xl:space-y-3">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">
              Fatura Sem Parar · {dia(e.periodoDe)} a {dia(e.periodoAte)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {e.passagens} linhas · {e.placas.length} caminhão(ões) · pedágio {brl(e.totalPedagio)}
              {e.totalNota != null && <> · nota fiscal {brl(e.totalNota)}</>} · {conferencias} de {e.checagens.length} conferências
              fecharam
            </p>
          </div>
          <Permitido chave="tag.importar">
            {e.temArquivo && (
              <Button variant="outline" size="sm" onClick={() => setVendoPdf(true)}>
                <FileText className="h-4 w-4" aria-hidden />
                Ver o PDF original
              </Button>
            )}
          </Permitido>
        </div>
        <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
          {e.checagens.map((c) => (
            <li key={c.n} className="flex items-start gap-1.5">
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" aria-label="fechou" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-label="não fechou" />
              )}
              <span>
                <b>{c.nome}.</b> <span className="text-muted-foreground">{c.detalhe}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 text-xs">
          {e.placas.map((p) => (
            <button
              key={p.placa}
              type="button"
              onClick={() => onCasar(p.placa)}
              className="rounded-full border px-2 py-0.5 hover:bg-muted"
              title="Casar as passagens deste caminhão com as viagens"
            >
              <b>{p.placa}</b> {brl(p.pedagio)} · {p.usos} linhas
              {!p.cadastrada && <span className="text-amber-700"> · sem cadastro</span>}
              {p.terceiro && <span className="text-amber-700"> · de terceiro</span>}
            </button>
          ))}
        </div>
        {(semCadastro.length > 0 || terceiros.length > 0) && (
          <p className="text-xs text-amber-800">
            {semCadastro.length > 0 &&
              `Placa(s) da fatura sem caminhão no cadastro: ${semCadastro.map((p) => p.placa).join(", ")} — o sistema não cria caminhão sozinho. `}
            {terceiros.length > 0 && `Caminhão de terceiro: ${terceiros.map((p) => p.placa).join(", ")} — não entra no lucro por caminhão.`}
          </p>
        )}
      </Card>

      {/* As três caixas, como na maquete. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Caixa
          titulo="PODE SER SEU"
          cor="laranja"
          valor={`até ${brl(r.podeSerSeu.ate)}`}
          texto={
            r.podeSerSeu.viagens > 0
              ? `${r.podeSerSeu.viagens} viagem(ns) carregada(s) sem vale-pedágio${r.podeSerSeu.valeParcial ? ` e ${brl(r.podeSerSeu.valeParcial)} de vale que cobriu só parte` : ""}. Se a carga era de terceiro, o contratante devia ter pago.`
              : "Nenhuma viagem carregada sem vale nesta fatura."
          }
          extra={r.podeSerSeu.confirmado > 0 ? `${brl(r.podeSerSeu.confirmado)} já confirmados por vocês em ${r.podeSerSeu.viagensConfirmadas} viagem(ns).` : null}
          botao="Dizer de quem era a carga"
          aberta={aberta === "seu"}
          onAbrir={() => setAberta(aberta === "seu" ? null : "seu")}
        />
        <Caixa
          titulo={`PRA CONTESTAR${r.praContestar.prazoAte ? ` · ATÉ ${diaSP(r.praContestar.prazoAte).slice(0, 5)}` : ""}`}
          cor="amarelo"
          valor={brl(r.praContestar.valor)}
          texto={
            r.praContestar.itens.length
              ? `${r.praContestar.itens.length} ponto(s) pra conferir com o Sem Parar. O prazo de contestação é de 90 dias da passagem.`
              : "Nada pra contestar nesta fatura."
          }
          botao="Ver e gerar a lista"
          aberta={aberta === "contestar"}
          onAbrir={() => setAberta(aberta === "contestar" ? null : "contestar")}
        />
        <Caixa
          titulo="PRA CONVERSAR"
          cor="cinza"
          valor={brl(r.praConversar.valor)}
          texto={r.praConversar.itens.map((i) => i.titulo).join(" · ") || "Nada pra conversar."}
          botao="Ver detalhes"
          aberta={aberta === "conversar"}
          onAbrir={() => setAberta(aberta === "conversar" ? null : "conversar")}
        />
      </div>

      {aberta === "seu" && <PodeSerSeu itens={r.podeSerSeu.itens} />}
      {aberta === "contestar" && <PraContestar extratoId={extratoId} itens={r.praContestar.itens} />}
      {aberta === "conversar" && <ListaAchados itens={r.praConversar.itens} />}

      <Card className="space-y-3 p-4">
        <p className="text-xs font-extrabold tracking-wider text-muted-foreground">VIAGENS × TAG</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Numero
            n={r.ligacaoAutomatica ? r.viagensXTag.ligadas : r.viagensXTag.ligariamSozinhas}
            texto={r.ligacaoAutomatica ? "ligadas sozinhas" : "o sistema ligaria sozinho (é o 1º mês: confirme)"}
          />
          <Numero n={r.viagensXTag.sugestoes - r.viagensXTag.ligariamSozinhas} texto="sugestões com dúvida pra você ver" tom="amarelo" />
          <Numero n={r.viagensXTag.semViagem.trechos} texto={`trecho(s) carregado(s) sem viagem lançada (${brl(r.viagensXTag.semViagem.valor)}) — frete que pode não ter sido cobrado`} />
          <Numero n={r.viagensXTag.vaziosSoltos.trechos} texto={`passagens vazias soltas (${brl(r.viagensXTag.vaziosSoltos.valor)})`} />
        </div>
        {r.viagensSemPassagem.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">
              {r.viagensSemPassagem.length} viagem(ns) lançada(s) com praça na rota e nenhuma passagem na tag:
            </p>
            <ul className="text-xs text-muted-foreground">
              {r.viagensSemPassagem.map((x, i) => (
                <li key={x.viagem?.id ?? i}>
                  {x.viagem ? `${dia(x.viagem.data)} · ${x.viagem.placa} · ${x.viagem.rotulo}` : "viagem"} · {x.pracas} praça(s) na rota — a tag
                  não leu, pagou por fora, foi outro caminho, ou a viagem foi lançada no caminhão errado.
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {r.viagensXTag.retornos.trechos} trecho(s) vazio(s) ficaram como retorno ou ida vazia de uma viagem ({brl(r.viagensXTag.retornos.valor)}).
        </p>
        <Button className="self-start" onClick={() => onCasar(e.placas[0]?.placa ?? "")}>
          Casar passagens com viagens
        </Button>
      </Card>

      <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
        Tudo aqui é sugestão pra conferir: o sistema mostra e documenta, quem decide cobrar o contratante ou contestar é a
        empresa. Quando você subcontrata, a lei põe você no lugar do embarcador: o vale do subcontratado é seu.
      </p>

      <RelatorioContratantes />
      {vendoPdf && <PdfOriginal extratoId={extratoId} onFechar={() => setVendoPdf(false)} />}
    </div>
  );
}

const CORES = {
  laranja: { caixa: "border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30", cap: "text-[#B4501A]" },
  amarelo: { caixa: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30", cap: "text-amber-800" },
  cinza: { caixa: "", cap: "text-muted-foreground" },
};

function Caixa(p: {
  titulo: string;
  cor: keyof typeof CORES;
  valor: string;
  texto: string;
  extra?: string | null;
  botao: string;
  aberta: boolean;
  onAbrir: () => void;
}) {
  return (
    <Card className={cn("flex flex-col gap-2 p-4", CORES[p.cor].caixa)}>
      <p className={cn("text-xs font-extrabold tracking-wider", CORES[p.cor].cap)}>{p.titulo}</p>
      <p className="text-2xl font-extrabold max-2xl:text-xl">{p.valor}</p>
      <p className="flex-1 text-sm text-muted-foreground">{p.texto}</p>
      {p.extra && <p className="text-xs text-green-800">{p.extra}</p>}
      <Button variant={p.cor === "laranja" ? "default" : "outline"} size="sm" className="self-start" onClick={p.onAbrir}>
        {p.aberta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {p.botao}
      </Button>
    </Card>
  );
}

function Numero({ n, texto, tom }: { n: number; texto: string; tom?: "amarelo" }) {
  return (
    <div>
      <p className={cn("text-2xl font-extrabold", tom === "amarelo" && "text-amber-800")}>{n}</p>
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  );
}

function Passagens({ ps }: { ps: PassagemTela[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {ps.map((p) => (
        <li key={p.id}>
          {p.quando.slice(0, 8)} {p.hora} · {p.cidade} {p.sentido} · {p.eixos} eixos · {brl(p.valor)}
          {p.tipo === "VALE" && " · pago pelo vale"}
        </li>
      ))}
    </ul>
  );
}

/** "Essa carga era de quem?" — uma vez por viagem, com as 4 respostas (04-qa I1, I2). */
function PodeSerSeu({ itens }: { itens: Achado[] }) {
  return (
    <Card className="divide-y p-0">
      {itens.map((a) => (
        <div key={a.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold">
                {a.placa} · {a.titulo}
              </p>
              <p className="text-sm text-muted-foreground">{a.explicacao}</p>
              {a.viagem && (
                <p className="text-xs">
                  Viagem lançada: <b>{a.viagem.rotulo}</b>
                  {a.viagem.cliente && ` · cliente ${a.viagem.cliente}`}
                </p>
              )}
              <Passagens ps={a.passagens} />
            </div>
            <span className="text-lg font-bold">
              {a.resposta?.resposta === "CLIENTE" ? "" : "até "}
              {brl(a.valor)}
            </span>
          </div>
          {a.tipo === "CARREGADO_SEM_VALE" && a.passagemAncoraId && <DeQuemEraACarga a={a} />}
        </div>
      ))}
    </Card>
  );
}

function DeQuemEraACarga({ a }: { a: Achado }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [editando, setEditando] = React.useState(!a.resposta);
  const [resposta, setResposta] = React.useState<RespostaCargaTag | "">(a.resposta?.resposta ?? "");
  const [empresaId, setEmpresaId] = React.useState<string | undefined>(a.resposta?.empresa?.id ?? a.empresaSugeridaId ?? undefined);
  const [comprovante, setComprovante] = React.useState(a.resposta?.comprovante ?? "");
  const [salvando, setSalvando] = React.useState(false);

  async function salvar() {
    if (!token || !resposta) return;
    setSalvando(true);
    try {
      await fetchApi("/admin/tag-pedagio/respostas-carga", {
        token,
        method: "POST",
        body: JSON.stringify({
          passagemAncoraId: a.passagemAncoraId,
          resposta,
          empresaId: resposta === "CLIENTE" ? empresaId : undefined,
          comprovante: resposta === "PAGOU_DE_OUTRO_JEITO" ? comprovante || undefined : undefined,
        }),
      });
      toast.success("Resposta guardada.");
      setEditando(false);
      await qc.invalidateQueries({ queryKey: ["tag"] });
    } catch (e) {
      toast.error("Não consegui guardar", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSalvando(false);
    }
  }

  if (!editando && a.resposta)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-muted px-2 py-0.5">
          {RESPOSTA_CARGA_TAG_ROTULO[a.resposta.resposta]}
          {a.resposta.empresa && `: ${a.resposta.empresa.nome}`}
          {a.resposta.comprovante && ` (${a.resposta.comprovante})`}
        </span>
        <Permitido chave="tag.decidir">
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            Mudar a resposta
          </Button>
        </Permitido>
      </div>
    );

  return (
    <Permitido chave="tag.decidir">
      <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2">
        <div className="space-y-1">
          <Label htmlFor={`resp-${a.id}`}>Essa carga era de quem?</Label>
          <Select id={`resp-${a.id}`} className="w-64" value={resposta} onChange={(e) => setResposta(e.target.value as RespostaCargaTag)}>
            <option value="">Escolha…</option>
            {(Object.keys(RESPOSTA_CARGA_TAG_ROTULO) as RespostaCargaTag[]).map((k) => (
              <option key={k} value={k}>
                {RESPOSTA_CARGA_TAG_ROTULO[k]}
              </option>
            ))}
          </Select>
        </div>
        {resposta === "CLIENTE" && (
          <div className="space-y-1">
            <Label>Cliente</Label>
            <AsyncCombobox<{ id: string; nome: string }>
              path="/admin/empresas"
              mapOption={(x) => ({ value: x.id, label: x.nome })}
              value={empresaId}
              onChange={setEmpresaId}
              resolvePorId
              placeholder="Qual cliente?"
              className="w-64"
            />
          </div>
        )}
        {resposta === "PAGOU_DE_OUTRO_JEITO" && (
          <div className="space-y-1">
            <Label htmlFor={`comp-${a.id}`}>Como pagou (CIOT, comprovante, outra tag)</Label>
            <Input id={`comp-${a.id}`} className="w-72" value={comprovante} onChange={(e) => setComprovante(e.target.value)} />
          </div>
        )}
        <Button
          size="sm"
          variant="success"
          disabled={!resposta || salvando || (resposta === "CLIENTE" && !empresaId)}
          onClick={salvar}
        >
          Guardar a resposta
        </Button>
        {a.resposta && (
          <Button size="sm" variant="outline" onClick={() => setEditando(false)}>
            Voltar
          </Button>
        )}
        {resposta === "PAGOU_DE_OUTRO_JEITO" && (
          <p className="basis-full text-xs text-muted-foreground">
            Se foi por outra tag, a passagem do Sem Parar pode ter sido cobrada em duas tags — aí é contestar no Sem Parar,
            não cobrar o contratante.
          </p>
        )}
      </div>
    </Permitido>
  );
}

function ListaAchados({ itens, comDecisao }: { itens: Achado[]; comDecisao?: boolean }) {
  return (
    <Card className="divide-y p-0">
      {itens.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nada aqui.</p>}
      {itens.map((a) => (
        <div key={a.id} className={cn("space-y-1 p-4", a.status === "DESCARTADO" && "opacity-60")}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="font-semibold">
              {a.placa ? `${a.placa} · ` : ""}
              {a.titulo}
            </p>
            <span className="font-bold">{a.valor == null ? "—" : brl(a.valor)}</span>
          </div>
          {a.explicacoes ? (
            <div className="text-sm text-muted-foreground">
              <p>Explicações possíveis (escolha uma ao conferir):</p>
              <ol className="list-decimal pl-5">
                {a.explicacoes.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{a.explicacao}</p>
          )}
          {a.prazoEm && <p className="text-xs font-semibold text-amber-800">Contestar até {diaSP(a.prazoEm)}</p>}
          <Passagens ps={a.passagens} />
          {comDecisao && <DecisaoAchado a={a} />}
        </div>
      ))}
    </Card>
  );
}

function DecisaoAchado({ a }: { a: Achado }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [descartando, setDescartando] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  async function mudar(status: Achado["status"], m?: string) {
    if (!token) return;
    try {
      await fetchApi(`/admin/tag-pedagio/achados/${a.id}`, { token, method: "PATCH", body: JSON.stringify({ status, motivo: m }) });
      setDescartando(false);
      await qc.invalidateQueries({ queryKey: ["tag"] });
    } catch (e) {
      toast.error("Não consegui guardar", { description: e instanceof Error ? e.message : undefined });
    }
  }
  if (a.status !== "ABERTO")
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-muted px-2 py-0.5">
          {a.status === "CONTESTADO" ? "Contestado no Sem Parar" : a.status === "CONFERIDO" ? "Conferido, está certo" : `Descartado: ${a.motivo}`}
        </span>
        <Permitido chave="tag.decidir">
          <Button size="sm" variant="outline" onClick={() => mudar("ABERTO")}>
            Desfazer
          </Button>
        </Permitido>
      </div>
    );
  return (
    <Permitido chave="tag.decidir">
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" variant="success" onClick={() => mudar("CONTESTADO")}>
          Marcar como contestado
        </Button>
        <Button size="sm" variant="outline" onClick={() => mudar("CONFERIDO")}>
          Conferi, a cobrança está certa
        </Button>
        <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setDescartando(true)}>
          Descartar
        </Button>
        {descartando && (
          <div className="flex basis-full flex-wrap items-center gap-2 rounded-md bg-red-50 p-2 dark:bg-red-950/30">
            <Input className="w-80" placeholder="Por que descartar?" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => setDescartando(false)}>
              Voltar
            </Button>
            <Button size="sm" variant="destructive" disabled={motivo.trim().length < 3} onClick={() => mudar("DESCARTADO", motivo.trim())}>
              Descartar
            </Button>
          </div>
        )}
      </div>
    </Permitido>
  );
}

type LinhaContestacao = PassagemTela & { achado: string; tipoAchado: string; status: string; prazoEm: string | null };

function PraContestar({ extratoId, itens }: { extratoId: string; itens: Achado[] }) {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["tag", "contestacao", extratoId],
    enabled: Boolean(token),
    queryFn: () => fetchApi<LinhaContestacao[]>(`/admin/tag-pedagio/extratos/${extratoId}/contestacao`, { token: token! }),
  });
  function baixarCsv() {
    const linhas = [
      ["Data", "Hora", "Placa", "Praça", "Sentido", "Categoria", "Valor", "Contestar até", "Motivo"].join(";"),
      ...(q.data ?? []).map((l) =>
        [l.quando.slice(0, 8), l.hora, l.placa, l.praca, l.sentido, l.categoria, l.valor.toFixed(2).replace(".", ","), diaSP(l.prazoEm), l.achado].join(";"),
      ),
    ];
    const blob = new Blob([`﻿${linhas.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "contestacao-sem-parar.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="space-y-3">
      <ListaAchados itens={itens} comDecisao />
      {q.data && q.data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Lista pra contestação no Sem Parar</h3>
            <Button size="sm" variant="outline" onClick={baixarCsv}>
              Baixar a lista (CSV)
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Hora</th>
                <th className="px-3 py-2">Placa</th>
                <th className="px-3 py-2">Praça</th>
                <th className="px-3 py-2">Sentido</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Contestar até</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {q.data.map((l) => (
                <tr key={`${l.id}-${l.achado}`}>
                  <td className="px-3 py-1.5">{l.quando.slice(0, 8)}</td>
                  <td className="px-3 py-1.5">{l.hora}</td>
                  <td className="px-3 py-1.5">{l.placa}</td>
                  <td className="px-3 py-1.5">{l.praca}</td>
                  <td className="px-3 py-1.5">{l.sentido}</td>
                  <td className="px-3 py-1.5 text-right">{brl(l.valor)}</td>
                  <td className="px-3 py-1.5">{diaSP(l.prazoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

type GrupoContratante = {
  empresa: { id: string; nome: string; cnpj: string | null };
  total: number;
  viagens: { placa: string; titulo: string; valor: number; passagens: PassagemTela[] }[];
};

/** O papel pra conversa com o contratante: só viagem que GENTE confirmou "de terceiro, sem vale". */
function RelatorioContratantes() {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["tag", "contratantes"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<GrupoContratante[]>("/admin/tag-pedagio/contratantes", { token: token! }),
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">Vale-pedágio não recebido, por cliente</h3>
      <p className="text-xs text-muted-foreground">Só as viagens que vocês confirmaram como carga do cliente, sem vale.</p>
      {q.data.map((g) => (
        <details key={g.empresa.id} className="rounded-md border p-2">
          <summary className="cursor-pointer text-sm">
            <b>{g.empresa.nome}</b> · {g.viagens.length} viagem(ns) · {brl(g.total)}
          </summary>
          {g.viagens.map((v) => (
            <div key={v.titulo + v.placa} className="mt-2 text-sm">
              <p>
                {v.placa} · {v.titulo} · {brl(v.valor)}
              </p>
              <Passagens ps={v.passagens} />
            </div>
          ))}
        </details>
      ))}
    </Card>
  );
}

/** O PDF abre NA TELA, buscado pela API com o token (o bucket nunca tem link público). */
function PdfOriginal({ extratoId, onFechar }: { extratoId: string; onFechar: () => void }) {
  const token = useAuthToken();
  const [url, setUrl] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  React.useEffect(() => {
    let u: string | null = null;
    void (async () => {
      try {
        const r = await fetch(`${apiBaseUrl}/admin/tag-pedagio/extratos/${extratoId}/arquivo`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? "Não consegui abrir o PDF.");
        u = URL.createObjectURL(await r.blob());
        setUrl(u);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui abrir o PDF.");
      }
    })();
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [extratoId, token]);
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>PDF original da fatura</DialogTitle>
        </DialogHeader>
        {erro && <p className="text-sm text-red-700">{erro}</p>}
        {!url && !erro && <p className="text-sm text-muted-foreground">Abrindo…</p>}
        {url && <iframe title="PDF da fatura" src={url} className="h-[75vh] w-full rounded-md border" />}
      </DialogContent>
    </Dialog>
  );
}
