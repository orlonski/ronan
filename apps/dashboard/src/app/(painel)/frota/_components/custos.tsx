"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { Gauge, TriangleAlert, Wallet, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingCard } from "@/components/loading";
import { StatCard } from "@/components/stat-card";
import { VeiculoCombobox } from "@/components/fk-comboboxes";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { cn } from "@/lib/utils";

/**
 * Para onde vai o dinheiro da manutenção. A conta mora em
 * `apps/api/src/common/custo-manutencao.ts`.
 *
 * O gráfico separa só duas coisas — PROGRAMADA (preventiva, pneu, outro) e
 * QUEBRA (corretiva, sinistro) — porque é a pergunta do dono: "estou gastando
 * planejado ou apagando incêndio?". Cinco cores pros cinco tipos do cadastro
 * respondiam outra coisa, e pior.
 *
 * Cores: slots 1 e 2 da paleta de referência (azul / laranja), validados
 * juntos em claro e escuro. Identidade nunca só por cor: legenda sempre
 * visível, tooltip nomeia a série, e há a visão em tabela.
 */

type Resumo = {
  periodo: { de: string; ate: string };
  totais: {
    gasto: number;
    consertos: number;
    semValor: number;
    mediaMes: number;
    quebraPct: number | null;
    kmRodado: number;
    porKm: number | null;
  };
  porMes: { mes: string; programada: number; quebra: number; total: number; consertos: number }[];
  porCaminhao: {
    veiculoId: string;
    placa: string;
    modelo: string | null;
    gasto: number;
    consertos: number;
    quebraPct: number | null;
    kmRodado: number;
    porKm: number | null;
  }[];
  porServico: { nome: string; vezes: number; gasto: number }[];
  porOficina: { nome: string; consertos: number; gasto: number }[];
};

const COR_PROGRAMADA = "bg-[#2a78d6] dark:bg-[#3987e5]";
const COR_QUEBRA = "bg-[#eb6834] dark:bg-[#d95926]";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlCurto = (v: number) =>
  v >= 1000
    ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: v >= 10000 ? 0 : 1 })} mil`
    : brl(v);
const pct = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

/** Primeiro dia do mês, N meses atrás, em AAAA-MM-DD (calendário de Brasília). */
function inicioMesesAtras(n: number): string {
  const [a, m] = hojeSP().split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 - n, 1));
  return d.toISOString().slice(0, 10);
}

const PRESETS: { rotulo: string; de: () => string; ate: () => string }[] = [
  { rotulo: "Últimos 12 meses", de: () => inicioMesesAtras(11), ate: hojeSP },
  { rotulo: "Este ano", de: () => `${hojeSP().slice(0, 4)}-01-01`, ate: hojeSP },
  { rotulo: "Últimos 3 meses", de: () => inicioMesesAtras(2), ate: hojeSP },
];

/** Teto do eixo: o próximo valor "redondo" acima do maior mês. */
function tetoRedondo(max: number): number {
  if (max <= 0) return 1000;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * mag >= max) return f * mag;
  return 10 * mag;
}

export function CustosManutencao() {
  const token = useAuthToken();
  const [de, setDe] = React.useState(PRESETS[0]!.de());
  const [ate, setAte] = React.useState(hojeSP());
  const [veiculoId, setVeiculoId] = React.useState<string | undefined>();

  const q = useQuery({
    queryKey: ["manutencao-custos", de, ate, veiculoId],
    enabled: Boolean(token && de && ate),
    queryFn: () =>
      fetchApi<Resumo>(
        `/admin/manutencao/custos?${new URLSearchParams({ de, ate, ...(veiculoId ? { veiculoId } : {}) })}`,
        { token: token! },
      ),
    placeholderData: (prev) => prev,
  });

  const d = q.data;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Input type="date" className="w-40" aria-label="De" value={de} onChange={(e) => setDe(e.target.value)} />
        <span className="text-sm text-muted-foreground">até</span>
        <Input type="date" className="w-40" aria-label="Até" value={ate} onChange={(e) => setAte(e.target.value)} />
        {PRESETS.map((p) => (
          <Button
            key={p.rotulo}
            type="button"
            size="sm"
            variant={de === p.de() && ate === p.ate() ? "outline" : "ghost"}
            onClick={() => {
              setDe(p.de());
              setAte(p.ate());
            }}
          >
            {p.rotulo}
          </Button>
        ))}
        <div className="w-full sm:ml-auto sm:w-56">
          <VeiculoCombobox value={veiculoId} onChange={setVeiculoId} placeholder="Todos os caminhões" />
        </div>
      </Card>

      {q.error && <Card className="border-l-4 border-l-red-500 p-4 text-sm">{(q.error as Error).message}</Card>}
      {q.isLoading && <LoadingCard />}

      {d && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Wallet} label="Gasto no período" value={brl(d.totais.gasto)} subtitle={`${d.totais.consertos} consertos`} />
            <StatCard icon={Wrench} label="Média por mês" value={brl(d.totais.mediaMes)} />
            <StatCard
              icon={TriangleAlert}
              label="Foi quebra"
              value={pct(d.totais.quebraPct)}
              info="Quanto do gasto foi conserto corretivo ou sinistro — o que não estava planejado. Subindo, costuma ser revisão atrasada."
              tone={d.totais.quebraPct != null && d.totais.quebraPct >= 50 ? "warning" : "default"}
            />
            <StatCard
              icon={Gauge}
              label="Manutenção por km"
              value={d.totais.porKm != null ? brl(d.totais.porKm) : "—"}
              subtitle={d.totais.kmRodado > 0 ? `${d.totais.kmRodado.toLocaleString("pt-BR")} km rodados` : undefined}
              info="O gasto de manutenção dividido pelo km das viagens no período."
            />
          </div>

          {d.totais.semValor > 0 && (
            <Card className="border-l-4 border-l-amber-500 p-3 text-sm">
              {d.totais.semValor} conserto(s) concluído(s) sem valor não entraram na conta — o gasto real é maior.
            </Card>
          )}

          <GraficoMensal porMes={d.porMes} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden p-0">
              <h2 className="border-b px-4 py-3 text-sm font-semibold">Caminhões que mais gastam</h2>
              {d.porCaminhao.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhum conserto concluído no período.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="tabela-cartoes w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Caminhão</th>
                        <th className="px-3 py-2 text-right font-medium">Gasto</th>
                        <th className="px-3 py-2 text-right font-medium">Consertos</th>
                        <th className="px-3 py-2 text-right font-medium">Quebra</th>
                        <th className="px-3 py-2 text-right font-medium">Por km</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.porCaminhao.slice(0, 15).map((c) => (
                        <tr key={c.veiculoId} className="border-b last:border-0">
                          <td data-mobile="titulo" className="px-3 py-2">
                            <Link href={`/veiculos/${c.veiculoId}` as Route} className="font-medium text-blue-700 hover:underline">
                              {c.placa}
                            </Link>
                            {c.modelo && <span className="ml-1 text-xs text-muted-foreground">{c.modelo}</span>}
                          </td>
                          <td data-rotulo="Gasto" className="px-3 py-2 text-right tabular-nums">{brl(c.gasto)}</td>
                          <td data-rotulo="Consertos" className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.consertos}</td>
                          <td data-rotulo="Quebra" className="px-3 py-2 text-right tabular-nums">{pct(c.quebraPct)}</td>
                          <td data-rotulo="Por km" className="px-3 py-2 text-right tabular-nums">{c.porKm != null ? brl(c.porKm) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Ranking
                titulo="O que mais se conserta"
                vazio="Nenhum conserto concluído no período."
                itens={d.porServico.map((s) => ({ nome: s.nome, valor: s.gasto, detalhe: `${s.vezes}×` }))}
              />
              <Ranking
                titulo="Onde se gasta"
                vazio="Nenhuma oficina no período."
                itens={d.porOficina.map((o) => ({ nome: o.nome, valor: o.gasto, detalhe: `${o.consertos} conserto(s)` }))}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Barras empilhadas por mês: programada embaixo, quebra em cima. HTML puro —
 * o painel não tem biblioteca de gráfico, e 12–24 barras não pedem uma.
 * Tooltip por coluna (o alvo é a coluna inteira, não só a barra) e visão em
 * tabela pra quem não lê cor.
 */
function GraficoMensal({ porMes }: { porMes: Resumo["porMes"] }) {
  const [emTabela, setEmTabela] = React.useState(false);
  const [foco, setFoco] = React.useState<number | null>(null);
  const teto = tetoRedondo(Math.max(0, ...porMes.map((m) => m.total)));
  const linhas = [teto, teto / 2, 0];
  const ALTURA = 200;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Gasto por mês</h2>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-sm", COR_PROGRAMADA)} /> Programada
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-sm", COR_QUEBRA)} /> Quebra
          </span>
          <button type="button" className="text-blue-700 hover:underline" onClick={() => setEmTabela((v) => !v)}>
            {emTabela ? "Ver gráfico" : "Ver em tabela"}
          </button>
        </div>
      </div>

      {emTabela ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Mês</th>
                <th className="px-3 py-1.5 text-right font-medium">Programada</th>
                <th className="px-3 py-1.5 text-right font-medium">Quebra</th>
                <th className="px-3 py-1.5 text-right font-medium">Total</th>
                <th className="px-3 py-1.5 text-right font-medium">Consertos</th>
              </tr>
            </thead>
            <tbody>
              {porMes.map((m) => (
                <tr key={m.mes} className="border-b last:border-0">
                  <td className="px-3 py-1.5">{rotuloMes(m.mes)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(m.programada)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(m.quebra)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{brl(m.total)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{m.consertos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          {/* Eixo: três linhas de referência, rótulos em tinta de texto. */}
          <div className="relative w-14 shrink-0 text-right text-[11px] text-muted-foreground" style={{ height: ALTURA }}>
            {linhas.map((v) => (
              <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: ALTURA - (v / teto) * ALTURA }}>
                {brlCurto(v)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="relative" style={{ height: ALTURA, minWidth: porMes.length * 28 }}>
              {linhas.map((v) => (
                <div
                  key={v}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: ALTURA - (v / teto) * ALTURA }}
                />
              ))}
              <div className="absolute inset-0 flex items-end gap-1.5">
                {porMes.map((m, i) => {
                  const hProg = (m.programada / teto) * ALTURA;
                  const hQuebra = (m.quebra / teto) * ALTURA;
                  const ativo = foco === i;
                  return (
                    <button
                      key={m.mes}
                      type="button"
                      aria-label={`${rotuloMes(m.mes)}: ${brl(m.total)}`}
                      className="relative flex h-full flex-1 flex-col items-center justify-end outline-none"
                      onMouseEnter={() => setFoco(i)}
                      onMouseLeave={() => setFoco(null)}
                      onFocus={() => setFoco(i)}
                      onBlur={() => setFoco(null)}
                    >
                      {/* Largura fina; 2px de respiro entre os segmentos; só a ponta de cima arredondada. */}
                      <div className={cn("flex w-full max-w-7 flex-col justify-end gap-[2px]", ativo && "opacity-90")}>
                        {m.quebra > 0 && (
                          <div className={cn("w-full rounded-t-[4px]", COR_QUEBRA)} style={{ height: Math.max(2, hQuebra) }} />
                        )}
                        {m.programada > 0 && (
                          <div
                            className={cn("w-full", m.quebra > 0 ? "" : "rounded-t-[4px]", COR_PROGRAMADA)}
                            style={{ height: Math.max(2, hProg) }}
                          />
                        )}
                      </div>
                      {ativo && (
                        <div
                          className={cn(
                            "pointer-events-none absolute bottom-full z-10 mb-1 w-44 rounded-md border bg-popover p-2 text-left text-xs text-popover-foreground shadow-md",
                            i > porMes.length / 2 ? "right-0" : "left-0",
                          )}
                        >
                          <p className="mb-1 font-medium">{rotuloMes(m.mes)}</p>
                          <p className="flex justify-between gap-2">
                            <span className="flex items-center gap-1">
                              <span className={cn("h-2 w-2 rounded-sm", COR_PROGRAMADA)} /> Programada
                            </span>
                            <span className="tabular-nums">{brl(m.programada)}</span>
                          </p>
                          <p className="flex justify-between gap-2">
                            <span className="flex items-center gap-1">
                              <span className={cn("h-2 w-2 rounded-sm", COR_QUEBRA)} /> Quebra
                            </span>
                            <span className="tabular-nums">{brl(m.quebra)}</span>
                          </p>
                          <p className="mt-1 flex justify-between gap-2 border-t pt-1 font-medium">
                            <span>Total · {m.consertos} conserto(s)</span>
                          </p>
                          <p className="text-right font-medium tabular-nums">{brl(m.total)}</p>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-1 flex gap-1.5" style={{ minWidth: porMes.length * 28 }}>
              {porMes.map((m) => (
                <span key={m.mes} className="flex-1 text-center text-[11px] text-muted-foreground">
                  {rotuloMes(m.mes)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Lista curta com barra de proporção. Neutra de propósito: é magnitude, não
 * identidade — azul aqui leria como "programada", que é a cor do gráfico.
 */
function Ranking({
  titulo,
  vazio,
  itens,
}: {
  titulo: string;
  vazio: string;
  itens: { nome: string; valor: number; detalhe: string }[];
}) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">{titulo}</h2>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="space-y-2.5">
          {itens.map((i) => (
            <li key={i.nome} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">{i.nome}</span>
                <span className="shrink-0 tabular-nums">
                  {i.valor > 0 ? brl(i.valor) : <span className="text-amber-700">sem valor</span>}{" "}
                  <span className="text-xs text-muted-foreground">· {i.detalhe}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                <div className="h-1.5 rounded-full bg-foreground/35" style={{ width: `${(i.valor / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
