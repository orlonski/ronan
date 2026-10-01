"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, CircleHelp, CreditCard, TriangleAlert, Upload } from "lucide-react";
import { AbasDaTela } from "@/components/abas-da-tela";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { LoadingCard } from "@/components/loading";
import { StatCard } from "@/components/stat-card";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP } from "@/lib/datetime-br";
import { cn } from "@/lib/utils";
import { PeriodoPresets } from "../relatorios/_components/periodo-presets";

/**
 * Cartão combustível: o extrato da operadora (Ticket Log, Repom, Valecard…)
 * ao lado do que os motoristas lançaram. A conta mora em
 * `apps/api/src/common/cartao-combustivel.ts`.
 *
 * Fala de diferença, não de culpa: "passou no cartão e ninguém lançou" pode
 * ser esquecimento — a tela mostra o fato e o lançamento do lado, quem confere
 * decide.
 */

type Situacao = "CONFERE" | "DIVERGE" | "SO_NO_CARTAO" | "PLACA_DESCONHECIDA";

type Previa = {
  aba: string;
  colunas: { chave: string; rotulo: string; obrigatorio: boolean; achada: boolean }[];
  total: number;
  novas: number;
  repetidas: number;
  ignoradas: number;
  erros: { linha: number; mensagem: string }[];
  totalErros: number;
  placasDesconhecidas: string[];
  valor: number;
  periodo: { de: string; ate: string } | null;
};

type Conciliacao = {
  resumo: Record<Situacao, number> & { valorCartao: number; valorSemLancamento: number; lancadosSemCartao: number };
  linhas: {
    id: string;
    data: string;
    placa: string | null;
    veiculoId: string | null;
    motorista: string | null;
    posto: string | null;
    combustivel: string | null;
    litros: number | null;
    valor: number;
    situacao: Situacao;
    texto: string;
    lancado: { id: string; data: string; litros: number; valor: number | null; motorista: string } | null;
  }[];
  lancadosSemCartao: {
    id: string;
    data: string;
    placa: string;
    motorista: string;
    litros: number;
    valor: number | null;
    posto: string | null;
  }[];
};

type Extrato = {
  id: string;
  nomeArquivo: string;
  operadora: string | null;
  periodoDe: string;
  periodoAte: string;
  transacoes: number;
  importadoEm: string;
  importadoPor: { nome: string } | null;
};

const SITUACAO: Record<Situacao, { rotulo: string; classe: string }> = {
  CONFERE: { rotulo: "Confere", classe: "border-green-200 bg-green-100 text-green-800" },
  DIVERGE: { rotulo: "Diferente do lançado", classe: "border-amber-300 bg-amber-100 text-amber-900" },
  SO_NO_CARTAO: { rotulo: "Ninguém lançou", classe: "border-red-200 bg-red-100 text-red-800" },
  PLACA_DESCONHECIDA: { rotulo: "Placa desconhecida", classe: "border-slate-200 bg-slate-100 text-slate-700" },
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const litros = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} L`;
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export default function CartaoCombustivelPage() {
  return (
    <RequerTela chave="cartao-combustivel.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const [de, setDe] = React.useState(primeiroDiaDoMesSP());
  const [ate, setAte] = React.useState(ultimoDiaDoMesSP());
  const [situacao, setSituacao] = React.useState<Situacao | "">("");

  const conc = useQuery({
    queryKey: ["cartao-conciliacao", de, ate],
    enabled: Boolean(token),
    queryFn: () =>
      fetchApi<Conciliacao>(`/admin/cartao-combustivel/conciliacao?de=${de}&ate=${ate}`, { token: token! }),
    placeholderData: (prev) => prev,
  });
  const d = conc.data;
  const linhas = d ? (situacao ? d.linhas.filter((l) => l.situacao === situacao) : d.linhas) : [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cartão combustível</h1>
        <p className="text-sm text-muted-foreground">
          O extrato da operadora do cartão ao lado do que os motoristas lançaram no app.
        </p>
      </header>

      <AbasDaTela grupo="abastecimentos" />

      <Permitido chave="cartao-combustivel.importar">
        <ImportarExtrato />
      </Permitido>

      <Card className="p-3">
        <PeriodoPresets
          de={de}
          ate={ate}
          onChange={(p) => {
            setDe(p.de);
            setAte(p.ate);
          }}
        />
      </Card>

      {conc.error && <Card className="border-l-4 border-l-red-500 p-4 text-sm">{(conc.error as Error).message}</Card>}
      {conc.isLoading && <LoadingCard />}

      {d && d.linhas.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhuma passada no cartão neste período. Importe o extrato da operadora acima.
        </Card>
      )}

      {d && d.linhas.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={CheckCircle2} label="Confere" value={d.resumo.CONFERE} subtitle={`de ${d.linhas.length} passadas · ${brl(d.resumo.valorCartao)}`} tone="success" />
            <StatCard
              icon={TriangleAlert}
              label="Diferente do lançado"
              value={d.resumo.DIVERGE}
              info="Casou com um lançamento do mesmo caminhão no mesmo dia, mas os litros ou o valor não batem."
              tone={d.resumo.DIVERGE > 0 ? "warning" : "default"}
            />
            <StatCard
              icon={CreditCard}
              label="Ninguém lançou"
              value={d.resumo.SO_NO_CARTAO}
              subtitle={d.resumo.SO_NO_CARTAO > 0 ? brl(d.resumo.valorSemLancamento) : undefined}
              info="Passou no cartão e nenhum abastecimento desse caminhão foi lançado no dia (nem no dia vizinho)."
              tone={d.resumo.SO_NO_CARTAO > 0 ? "danger" : "default"}
            />
            <StatCard
              icon={CircleHelp}
              label="Placa desconhecida"
              value={d.resumo.PLACA_DESCONHECIDA}
              info="A placa do extrato não está no cadastro de caminhões. Cadastre o caminhão ou confira a placa."
            />
          </div>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Passadas no cartão</h2>
              <Select
                aria-label="Filtrar por situação"
                className="w-56"
                value={situacao}
                onChange={(e) => setSituacao(e.target.value as Situacao | "")}
              >
                <option value="">Todas</option>
                {(Object.keys(SITUACAO) as Situacao[]).map((s) => (
                  <option key={s} value={s}>
                    {SITUACAO[s].rotulo} ({d.resumo[s]})
                  </option>
                ))}
              </Select>
            </div>
            <div className="overflow-x-auto">
              <table className="tabela-cartoes w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Quando · caminhão</th>
                    <th className="px-3 py-2 text-left font-medium">Posto</th>
                    <th className="px-3 py-2 text-right font-medium">No cartão</th>
                    <th className="px-3 py-2 text-left font-medium">Lançado no app</th>
                    <th className="px-3 py-2 text-left font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id} className="border-b align-top last:border-0">
                      <td data-mobile="titulo" className="px-3 py-2">
                        <span className="font-medium">{l.placa ?? "—"}</span>
                        <span className="block text-xs text-muted-foreground">{dataHora(l.data)}</span>
                      </td>
                      <td data-rotulo="Posto" className="px-3 py-2">
                        {l.posto ?? "—"}
                        {l.combustivel && <span className="block text-xs text-muted-foreground">{l.combustivel}</span>}
                      </td>
                      <td data-rotulo="No cartão" className="px-3 py-2 text-right tabular-nums">
                        {brl(l.valor)}
                        {l.litros != null && <span className="block text-xs text-muted-foreground">{litros(l.litros)}</span>}
                      </td>
                      <td data-rotulo="Lançado" className="px-3 py-2">
                        {l.lancado ? (
                          <Link href={`/abastecimentos/${l.lancado.id}` as Route} className="hover:underline">
                            <span className="tabular-nums">
                              {l.lancado.valor != null ? brl(l.lancado.valor) : "sem valor"} · {litros(l.lancado.litros)}
                            </span>
                            <span className="block text-xs text-muted-foreground">{l.lancado.motorista}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td data-rotulo="Situação" className="px-3 py-2">
                        <Badge className={SITUACAO[l.situacao].classe}>{SITUACAO[l.situacao].rotulo}</Badge>
                        {l.texto && l.situacao !== "CONFERE" && (
                          <p className="mt-1 max-w-xs text-xs text-muted-foreground">{l.texto}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {d.resumo.lancadosSemCartao > 0 && (
            <details className="rounded-lg border bg-card p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                {d.resumo.lancadosSemCartao} abastecimento(s) lançado(s) que não aparecem no cartão
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">
                De caminhões que usam o cartão. Pode ser abastecimento pago de outro jeito (dinheiro,
                outro cartão) — ou lançado em dobro.
              </p>
              <ul className="mt-2 divide-y">
                {d.lancadosSemCartao.map((a) => (
                  <li key={a.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                    <Link href={`/abastecimentos/${a.id}` as Route} className="hover:underline">
                      {a.placa} · {dia(a.data)} · {a.motorista}
                      {a.posto && <span className="text-muted-foreground"> · {a.posto}</span>}
                    </Link>
                    <span className="tabular-nums">
                      {a.valor != null ? brl(a.valor) : "sem valor"} · {litros(a.litros)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <ExtratosImportados />
    </div>
  );
}

function ImportarExtrato() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [operadora, setOperadora] = React.useState("");
  const [previa, setPrevia] = React.useState<Previa | null>(null);
  const [ocupado, setOcupado] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function form(): FormData {
    const f = new FormData();
    f.append("arquivo", arquivo!);
    if (operadora.trim()) f.append("operadora", operadora.trim());
    return f;
  }

  async function conferir(f: File) {
    if (!token) return;
    setOcupado(true);
    setPrevia(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", f);
      setPrevia(await fetchApi<Previa>("/admin/cartao-combustivel/previa", { token, method: "POST", body: fd }));
    } catch (e) {
      toast.error("Não consegui ler o extrato", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    if (!token || !arquivo) return;
    setOcupado(true);
    try {
      const r = await fetchApi<{ transacoes: number }>("/admin/cartao-combustivel/importar", {
        token,
        method: "POST",
        body: form(),
      });
      toast.success(`${r.transacoes} passada(s) importada(s).`);
      setArquivo(null);
      setPrevia(null);
      if (inputRef.current) inputRef.current.value = "";
      await queryClient.invalidateQueries({ queryKey: ["cartao-conciliacao"] });
      await queryClient.invalidateQueries({ queryKey: ["cartao-extratos"] });
    } catch (e) {
      toast.error("Não consegui importar", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Importar extrato da operadora</h2>
        <p className="text-sm text-muted-foreground">
          Baixe o extrato de transações no site do cartão (Ticket Log, Repom, Valecard…) em planilha
          ou CSV e suba aqui. As colunas são reconhecidas sozinhas; o mesmo extrato subido de novo
          não duplica nada.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="extrato-arquivo">Arquivo</Label>
          <Input
            ref={inputRef}
            id="extrato-arquivo"
            type="file"
            accept=".xlsx,.xlsm,.csv"
            className="w-72"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setArquivo(f);
              if (f) void conferir(f);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="extrato-operadora">Operadora (opcional)</Label>
          <Input
            id="extrato-operadora"
            className="w-48"
            placeholder="Ex.: Ticket Log"
            value={operadora}
            onChange={(e) => setOperadora(e.target.value)}
          />
        </div>
        {ocupado && <span className="text-sm text-muted-foreground">Lendo…</span>}
      </div>

      {previa && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
          <p>
            <strong>{previa.total}</strong> passada(s)
            {previa.periodo && <> de {dia(previa.periodo.de)} a {dia(previa.periodo.ate)}</>} · {brl(previa.valor)}
            {previa.repetidas > 0 && <> · {previa.repetidas} já estavam importadas e ficam como estão</>}
            {previa.ignoradas > 0 && <> · {previa.ignoradas} linha(s) de total ou estorno ignorada(s)</>}
          </p>
          <p className="text-xs text-muted-foreground">
            Colunas reconhecidas:{" "}
            {previa.colunas.map((c, i) => (
              <span key={c.chave} className={cn(!c.achada && "line-through opacity-60")}>
                {c.rotulo}
                {i < previa.colunas.length - 1 ? ", " : ""}
              </span>
            ))}
          </p>
          {previa.placasDesconhecidas.length > 0 && (
            <p className="text-amber-800">
              Placa(s) fora do cadastro: {previa.placasDesconhecidas.join(", ")}. Entram assim mesmo e
              aparecem como "Placa desconhecida" até o caminhão ser cadastrado.
            </p>
          )}
          {previa.totalErros > 0 && (
            <div className="text-red-700">
              <p>{previa.totalErros} linha(s) não puderam ser lidas e ficam de fora:</p>
              <ul className="list-disc pl-5">
                {previa.erros.slice(0, 5).map((e) => (
                  <li key={e.linha}>
                    Linha {e.linha}: {e.mensagem}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              disabled={ocupado}
              onClick={() => {
                setPrevia(null);
                setArquivo(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              disabled={ocupado || previa.novas === 0}
              onClick={importar}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              {previa.novas === 0 ? "Nada novo pra importar" : `Importar ${previa.novas} passada(s)`}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ExtratosImportados() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [desfazendo, setDesfazendo] = React.useState<string | null>(null);
  const q = useQuery({
    queryKey: ["cartao-extratos"],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Extrato[]>("/admin/cartao-combustivel/extratos", { token: token! }),
  });
  if (!q.data || q.data.length === 0) return null;

  async function desfazer(id: string) {
    if (!token) return;
    try {
      await fetchApi(`/admin/cartao-combustivel/extratos/${id}`, { token, method: "DELETE" });
      toast.success("Importação desfeita.");
      setDesfazendo(null);
      await queryClient.invalidateQueries({ queryKey: ["cartao-extratos"] });
      await queryClient.invalidateQueries({ queryKey: ["cartao-conciliacao"] });
    } catch (e) {
      toast.error("Não consegui desfazer", { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold">Extratos importados</h2>
      <ul className="divide-y text-sm">
        {q.data.map((e) => (
          <li key={e.id} className="space-y-2 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{e.nomeArquivo}</span>
                {e.operadora && <span className="text-muted-foreground"> · {e.operadora}</span>}
                <span className="block text-xs text-muted-foreground">
                  {dia(e.periodoDe)} a {dia(e.periodoAte)} · {e.transacoes} passada(s) nova(s) · importado em{" "}
                  {dataHora(e.importadoEm)}
                  {e.importadoPor && ` por ${e.importadoPor.nome}`}
                </span>
              </span>
              <Permitido chave="cartao-combustivel.importar">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => setDesfazendo(e.id)}
                >
                  Desfazer importação
                </Button>
              </Permitido>
            </div>
            {desfazendo === e.id && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 p-2 dark:bg-red-950/30">
                <span>As {e.transacoes} passada(s) deste extrato saem da conciliação.</span>
                <Button size="sm" variant="outline" onClick={() => setDesfazendo(null)}>
                  Voltar
                </Button>
                <Button size="sm" variant="destructive" onClick={() => desfazer(e.id)}>
                  Desfazer importação
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
