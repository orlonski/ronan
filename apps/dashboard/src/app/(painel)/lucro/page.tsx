"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Download, FileSpreadsheet, Percent, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import {
  type AvisosLucro,
  type CustosLucro,
  type LinhaLucroVeiculo,
  type RelatorioLucroResposta,
  TIPO_CUSTO_FIXO_LABEL,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LoadingCard } from "@/components/loading";
import { ErroCard } from "@/components/erro-estado";
import { RequerTela } from "@/components/requer-tela";
import { StatCard } from "@/components/stat-card";
import { ToolbarFilterDateRange } from "@/components/data-table";
import { useApiQuery } from "@/lib/client-api";
import { useBaixarArquivo } from "@/lib/fechamentos-api";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { usePermissoes } from "@/lib/permissoes";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP } from "@/lib/datetime-br";
import { fmtBRL } from "@/lib/fechamento-helpers";
import { cn } from "@/lib/utils";
import { PeriodoPresets } from "../relatorios/_components/periodo-presets";
import { Permitido } from "@/components/requer-tela";
import { CustosEmLote } from "./_components/custos-em-lote";

/**
 * Lucro por caminhão: o que cada um faturou menos o que a empresa gastou com
 * ele. A conta mora em `apps/api/src/common/lucro-veiculo.ts`.
 *
 * O pior caminhão vem primeiro — é o que a pessoa abre a tela pra ver. E o que
 * falta pra conta ficar certa (viagem sem preço, régua sem valor) aparece em
 * cima, porque um lucro bonito em cima de dado faltando é o pior resultado
 * possível desta tela.
 */

const ROTULO_CUSTO: Record<keyof CustosLucro, string> = {
  motorista: "Motorista",
  combustivel: "Combustível",
  pedagio: "Pedágio",
  manutencao: "Manutenção",
  multas: "Multas",
  custosFixos: "Custos fixos (IPVA, seguro, parcela…)",
  outrasContas: "Outras contas do caminhão",
};

function margemTexto(m: number | null): string {
  return m == null ? "—" : `${m.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function corDoSobrou(v: string): string {
  const n = Number(v);
  if (n < 0) return "text-red-700";
  if (n > 0) return "text-green-700";
  return "text-muted-foreground";
}

/** As frases do que está faltando — mesma lista na tela e na gaveta. */
function frasesDeAviso(a: AvisosLucro): { texto: string; href?: string; acao?: string }[] {
  const f: { texto: string; href?: string; acao?: string }[] = [];
  if (a.viagensSemPreco) {
    f.push({
      texto: `${a.viagensSemPreco} viagem(ns) sem preço cadastrado — o faturado está menor do que é.`,
      href: "/tabelas-preco",
      acao: "Cadastrar preço",
    });
  }
  if (a.viagensSemCustoMotorista) {
    f.push({
      texto: `${a.viagensSemCustoMotorista} viagem(ns) de motorista sem regra de pagamento — o custo dele não entrou.`,
      href: "/modalidades",
      acao: "Ver modalidades",
    });
  }
  if (a.viagensEmpregado) {
    f.push({
      texto: `${a.viagensEmpregado} viagem(ns) de motorista registrado. O salário dele entra como custo fixo do caminhão.`,
      href: "/veiculos",
      acao: "Cadastrar custo fixo",
    });
  }
  if (a.abastecimentosEstimados) {
    f.push({
      texto: `${a.abastecimentosEstimados} abastecimento(s) sem valor (comboio) foram calculados pelo preço médio do litro.`,
    });
  }
  if (a.abastecimentosSemPreco) {
    f.push({
      texto: `${a.abastecimentosSemPreco} abastecimento(s) sem valor e sem preço médio pra calcular não entraram.`,
    });
  }
  if (a.manutencoesSemValor) {
    f.push({
      texto: `${a.manutencoesSemValor} manutenção(ões) concluída(s) sem valor não entraram.`,
      href: "/frota",
      acao: "Abrir manutenção",
    });
  }
  return f;
}

export default function LucroPage() {
  return (
    <RequerTela chave="lucro-caminhao.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const { temPermissao } = usePermissoes();
  const podeExportar = temPermissao("lucro-caminhao.exportar");
  const baixar = useBaixarArquivo();
  const [baixando, setBaixando] = React.useState<"xlsx" | "pdf" | null>(null);
  const [aberto, setAberto] = React.useState<LinhaLucroVeiculo | null>(null);
  const [lote, setLote] = React.useState(false);

  const state = useDataTableState({
    defaultFilters: { de: primeiroDiaDoMesSP(), ate: ultimoDiaDoMesSP() },
  });
  const f = state.filters;
  const de = f.de;
  const ate = f.ate;
  const query = de && ate ? new URLSearchParams({ de, ate }).toString() : undefined;

  const { data, isLoading, error, refetch } = useApiQuery<RelatorioLucroResposta>(
    query ? `/admin/relatorios/lucro?${query}` : undefined,
    { staleTime: 30_000 },
  );

  async function exportar(formato: "xlsx" | "pdf") {
    if (!query) return;
    setBaixando(formato);
    try {
      await baixar(
        `/admin/relatorios/lucro/exportar?${query}&formato=${formato}`,
        `lucro-por-caminhao-${de}_${ate}.${formato}`,
      );
    } finally {
      setBaixando(null);
    }
  }

  const t = data?.frota;
  const avisos = t ? frasesDeAviso(t.avisos) : [];
  const fora = t ? Number(t.foraDaConta.combustivel) + Number(t.foraDaConta.pedagio) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lucro por caminhão</h1>
          <p className="text-sm text-muted-foreground">
            O que cada caminhão faturou menos o que ele custou no período.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Permitido chave="custos-veiculo.editar">
            <Button type="button" size="sm" disabled={!data} onClick={() => setLote(true)}>
              Cadastrar custos fixos
            </Button>
          </Permitido>
          {podeExportar && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data || baixando !== null}
                onClick={() => exportar("xlsx")}
              >
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                {baixando === "xlsx" ? "Gerando…" : "Excel"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!data || baixando !== null}
                onClick={() => exportar("pdf")}
              >
                <Download className="mr-1.5 h-4 w-4" />
                {baixando === "pdf" ? "Gerando…" : "PDF"}
              </Button>
            </>
          )}
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarFilterDateRange state={state} label="Período" />
          <PeriodoPresets de={de} ate={ate} onChange={(p) => state.setFilters({ ...f, ...p })} />
        </div>
      </Card>

      {!isLoading && error && <ErroCard erro={error} onRetry={() => void refetch()} />}
      {isLoading && <LoadingCard />}

      {data && t && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Wallet} label="Faturou" value={fmtBRL(t.faturou)} subtitle={`${t.viagens} viagens`} />
            <StatCard
              icon={TrendingDown}
              label="Gastou"
              value={fmtBRL(t.gastou)}
              subtitle={t.porKm ? `${fmtBRL(t.porKm.gastou)} por km · ${Number(t.km).toLocaleString("pt-BR")} km` : undefined}
              info="Motorista, combustível, pedágio, manutenção, multas, custos fixos e outras contas lançadas pro caminhão."
            />
            <StatCard
              icon={TrendingUp}
              label="Sobrou"
              value={fmtBRL(t.sobrou)}
              tone={Number(t.sobrou) < 0 ? "danger" : "success"}
            />
            <StatCard
              icon={Percent}
              label="Margem"
              value={margemTexto(t.margem)}
              info="Quanto sobra de cada R$ 100 faturados."
            />
          </div>

          {avisos.length > 0 && (
            <Card className="space-y-2 border-l-4 border-l-amber-500 p-4 text-sm">
              <p className="font-medium">Pra conta ficar certa, falta:</p>
              <ul className="space-y-1.5">
                {avisos.map((a) => (
                  <li key={a.texto} className="flex flex-wrap items-baseline gap-x-2">
                    <span>{a.texto}</span>
                    {a.href && (
                      <Link href={a.href as Route} className="text-blue-700 underline-offset-2 hover:underline">
                        {a.acao}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.veiculos.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nenhum caminhão com movimento no período.
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                {/* Celular: cada caminhão vira um bloco: ver `.tabela-cartoes` no globals.css. */}
                <table className="tabela-cartoes w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Caminhão</th>
                      <th className="px-3 py-2 text-right font-medium">Viagens</th>
                      <th className="px-3 py-2 text-right font-medium">Faturou</th>
                      <th className="px-3 py-2 text-right font-medium">Gastou</th>
                      <th className="px-3 py-2 text-right font-medium">Custo/km</th>
                      <th className="px-3 py-2 text-right font-medium">Sobrou</th>
                      <th className="px-3 py-2 text-right font-medium">Margem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.veiculos.map((v) => {
                      const faltando = frasesDeAviso(v.avisos).length > 0;
                      return (
                        <tr
                          key={v.veiculoId}
                          className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                          onClick={() => setAberto(v)}
                        >
                          <td data-mobile="titulo" className="px-3 py-2">
                            <span className="font-medium">{v.placa}</span>
                            {v.modelo && (
                              <span className="ml-1 text-xs text-muted-foreground">{v.modelo}</span>
                            )}
                            {faltando && (
                              <p className="mt-0.5 text-xs text-amber-700">Falta dado pra conta ficar certa</p>
                            )}
                          </td>
                          <td data-rotulo="Viagens" className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {v.viagens}
                          </td>
                          <td data-rotulo="Faturou" className="px-3 py-2 text-right tabular-nums">
                            {fmtBRL(v.faturou)}
                          </td>
                          <td data-rotulo="Gastou" className="px-3 py-2 text-right tabular-nums">
                            {fmtBRL(v.gastou)}
                          </td>
                          <td data-rotulo="Custo/km" className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {v.porKm ? fmtBRL(v.porKm.gastou) : "—"}
                          </td>
                          <td
                            data-rotulo="Sobrou"
                            className={cn("px-3 py-2 text-right font-semibold tabular-nums", corDoSobrou(v.sobrou))}
                          >
                            {fmtBRL(v.sobrou)}
                          </td>
                          <td data-rotulo="Margem" className="px-3 py-2 text-right tabular-nums">
                            {margemTexto(v.margem)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            Combustível e pedágio só entram quando a empresa pagou: diesel de comboio, ou
            motorista cuja modalidade devolve o que ele adiantou.
            {fora > 0 && (
              <>
                {" "}
                Neste período, {fmtBRL(String(fora))} foram pagos pelos motoristas do próprio bolso
                e ficaram fora da conta.
              </>
            )}
          </p>
        </>
      )}

      <DetalheCaminhao linha={aberto} onFechar={() => setAberto(null)} />
      <CustosEmLote
        aberto={lote}
        onFechar={() => setLote(false)}
        caminhoes={[...(data?.veiculos ?? [])].sort((a, b) => a.placa.localeCompare(b.placa))}
      />
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  forte,
  negativo,
  porKm,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
  negativo?: boolean;
  porKm?: string;
}) {
  const zero = Number(valor) === 0;
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1", forte && "font-semibold")}>
      <span className={cn(zero && !forte && "text-muted-foreground")}>{rotulo}</span>
      <span className={cn("tabular-nums", zero && !forte && "text-muted-foreground")}>
        {negativo && !zero ? "− " : ""}
        {fmtBRL(valor)}
        {porKm && !zero && (
          <span className="ml-2 inline-block w-20 text-right text-xs font-normal text-muted-foreground">
            {fmtBRL(porKm)}/km
          </span>
        )}
      </span>
    </div>
  );
}

function ListaDespesas({
  titulo,
  itens,
}: {
  titulo: string;
  itens: { id: string; data?: string; descricao: string; valor: string | null }[];
}) {
  if (itens.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <ul className="divide-y rounded-md border text-sm">
        {itens.map((i) => (
          <li key={i.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 truncate">
              {i.data && (
                <span className="mr-1.5 text-xs text-muted-foreground">
                  {i.data.split("-").reverse().join("/")}
                </span>
              )}
              {i.descricao}
            </span>
            <span className="shrink-0 tabular-nums">
              {i.valor == null ? <span className="text-amber-700">sem valor</span> : fmtBRL(i.valor)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetalheCaminhao({ linha, onFechar }: { linha: LinhaLucroVeiculo | null; onFechar: () => void }) {
  const avisos = linha ? frasesDeAviso(linha.avisos) : [];
  const fora = linha ? Number(linha.foraDaConta.combustivel) + Number(linha.foraDaConta.pedagio) : 0;
  return (
    <Sheet open={linha != null} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {linha && (
          <>
            <SheetHeader>
              <SheetTitle>
                {linha.placa}
                {linha.modelo && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{linha.modelo}</span>
                )}
              </SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-5 text-sm">
              <div>
                <Linha
                  rotulo={`Faturou (${linha.viagens} viagens · ${Number(linha.km).toLocaleString("pt-BR")} km)`}
                  valor={linha.faturou}
                  forte
                  porKm={linha.porKm?.faturou}
                />
                <div className="mt-1 border-l-2 pl-3">
                  {(Object.keys(ROTULO_CUSTO) as (keyof CustosLucro)[]).map((k) => (
                    <Linha key={k} rotulo={ROTULO_CUSTO[k]} valor={linha.custos[k]} negativo porKm={linha.porKm?.custos[k]} />
                  ))}
                </div>
                <div className="mt-2 border-t pt-2">
                  <Linha rotulo="Gastou" valor={linha.gastou} porKm={linha.porKm?.gastou} />
                  <div
                    className={cn(
                      "flex items-baseline justify-between py-1 text-base font-semibold",
                      corDoSobrou(linha.sobrou),
                    )}
                  >
                    <span>Sobrou</span>
                    <span className="tabular-nums">
                      {fmtBRL(linha.sobrou)}
                      <span className="ml-2 text-sm font-normal">{margemTexto(linha.margem)}</span>
                    </span>
                  </div>
                </div>
              </div>

              {avisos.length > 0 && (
                <div className="space-y-1 rounded-md border-l-4 border-l-amber-500 bg-amber-50 p-3 dark:bg-amber-950/30">
                  {avisos.map((a) => (
                    <p key={a.texto}>{a.texto}</p>
                  ))}
                </div>
              )}

              {fora > 0 && (
                <p className="text-muted-foreground">
                  Pago pelo motorista do próprio bolso, fora da conta: {fmtBRL(String(fora))}
                  {Number(linha.foraDaConta.combustivel) > 0 &&
                    ` (combustível ${fmtBRL(linha.foraDaConta.combustivel)})`}
                  .
                </p>
              )}

              <ListaDespesas titulo="Manutenção" itens={linha.detalhe.manutencoes} />
              <ListaDespesas titulo="Multas" itens={linha.detalhe.multas} />
              <ListaDespesas
                titulo="Custos fixos no período"
                itens={linha.detalhe.custosFixos.map((c) => ({
                  id: c.id,
                  descricao: `${TIPO_CUSTO_FIXO_LABEL[c.tipo as keyof typeof TIPO_CUSTO_FIXO_LABEL] ?? c.tipo} (${fmtBRL(c.valorMensal)}/mês)`,
                  valor: c.valorNoPeriodo,
                }))}
              />
              <ListaDespesas titulo="Outras contas" itens={linha.detalhe.outrasContas} />

              {linha.detalhe.custosFixos.length === 0 && (
                <p className="text-muted-foreground">
                  Nenhum custo fixo cadastrado (IPVA, seguro, parcela). Sem eles o lucro aparece maior
                  do que é.
                </p>
              )}

              <Button asChild variant="outline" size="sm">
                <Link href={`/veiculos/${linha.veiculoId}` as Route}>Abrir o caminhão</Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
