"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileSpreadsheet,
  Percent,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type {
  AvisosObra,
  CustosObra,
  LinhaResultadoObra,
  LinhaResultadoObraDetalhe,
  RelatorioResultadoObraResposta,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
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

/**
 * Resultado por obra: o que cada obra rendeu menos o que custou levar a carga
 * dela. A conta mora em `apps/api/src/common/resultado-obra.ts` e parte do
 * MESMO cálculo do lucro por caminhão — por isso o rodapé confere os dois.
 *
 * A pior obra vem primeiro, e "sem preço" aparece em âmbar na própria linha:
 * obra com viagem sem preço tem o custo inteiro e só parte da receita, e a
 * margem dela mente pra baixo se ninguém avisar.
 */

const ROTULO_CUSTO: Record<keyof CustosObra, string> = {
  motorista: "Motorista",
  pedagio: "Pedágio da viagem",
  combustivel: "Combustível",
  pedagioAvulso: "Pedágio avulso do caminhão",
  manutencao: "Manutenção",
  multas: "Multas",
  custosFixos: "Custos fixos (IPVA, seguro, parcela…)",
  outrasContas: "Outras contas do caminhão",
};
const DIRETOS: (keyof CustosObra)[] = ["motorista", "pedagio"];
const RATEADOS: (keyof CustosObra)[] = [
  "combustivel",
  "pedagioAvulso",
  "manutencao",
  "multas",
  "custosFixos",
  "outrasContas",
];

type Coluna = "obra" | "empresa" | "viagens" | "toneladas" | "receita" | "custo" | "margem" | "margemPct";

const COLUNAS: { chave: Coluna; rotulo: string; num: boolean }[] = [
  { chave: "obra", rotulo: "Obra", num: false },
  { chave: "empresa", rotulo: "Cliente", num: false },
  { chave: "viagens", rotulo: "Viagens", num: true },
  { chave: "toneladas", rotulo: "Toneladas", num: true },
  { chave: "receita", rotulo: "Receita", num: true },
  { chave: "custo", rotulo: "Custo", num: true },
  { chave: "margem", rotulo: "Margem", num: true },
  { chave: "margemPct", rotulo: "Margem %", num: true },
];

function valorDaColuna(l: LinhaResultadoObra, c: Coluna): string | number {
  switch (c) {
    case "obra":
      return l.obra;
    case "empresa":
      return l.empresa ?? "";
    case "viagens":
      return l.viagens;
    case "toneladas":
      return Number(l.toneladas);
    case "receita":
      return Number(l.receita.total);
    case "custo":
      return Number(l.custo);
    case "margem":
      return Number(l.margem);
    case "margemPct":
      // Sem receita não há margem %: vai pro fim, nos dois sentidos.
      return l.margemPct ?? Number.NEGATIVE_INFINITY;
  }
}

function margemTexto(m: number | null): string {
  return m == null ? "—" : `${m.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function corDaMargem(v: string): string {
  const n = Number(v);
  if (n < 0) return "text-red-700";
  if (n > 0) return "text-green-700";
  return "text-muted-foreground";
}

const fmtTon = (t: string) => Number(t).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function frasesDeAviso(a: AvisosObra, custoSemPreco?: string): { texto: string; href?: string; acao?: string }[] {
  const f: { texto: string; href?: string; acao?: string }[] = [];
  if (a.viagensSemPreco) {
    f.push({
      texto:
        `${a.viagensSemPreco} viagem(ns) sem preço — o custo delas` +
        (custoSemPreco ? ` (${fmtBRL(custoSemPreco)})` : "") +
        " entrou, a receita não.",
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
      texto: `${a.viagensEmpregado} viagem(ns) de motorista registrado. O salário entra pelo custo fixo do caminhão.`,
    });
  }
  return f;
}

export default function ResultadoObraPage() {
  return (
    <RequerTela chave="resultado-obra.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const { temPermissao } = usePermissoes();
  const podeExportar = temPermissao("resultado-obra.exportar");
  const podeVerLucro = temPermissao("lucro-caminhao.ver");
  const baixar = useBaixarArquivo();
  const [baixando, setBaixando] = React.useState<"xlsx" | "pdf" | null>(null);
  const [aberta, setAberta] = React.useState<LinhaResultadoObra | null>(null);
  const [ordem, setOrdem] = React.useState<{ coluna: Coluna; desc: boolean }>({ coluna: "margem", desc: false });

  const state = useDataTableState({
    defaultFilters: { de: primeiroDiaDoMesSP(), ate: ultimoDiaDoMesSP() },
  });
  const f = state.filters;
  const { de, ate, empresaId } = f;
  const params = de && ate ? new URLSearchParams({ de, ate, ...(empresaId ? { empresaId } : {}) }) : null;
  const query = params?.toString();

  const { data, isLoading, error, refetch } = useApiQuery<RelatorioResultadoObraResposta>(
    query ? `/admin/relatorios/resultado-obra?${query}` : undefined,
    { staleTime: 30_000 },
  );

  // As opções do filtro de cliente saem do próprio relatório — quem vê margem
  // não precisa ter acesso ao cadastro de clientes pra filtrar. Lembra as que
  // já viu: com o filtro aplicado, a resposta só traz um cliente.
  const [clientes, setClientes] = React.useState<Map<string, string>>(new Map());
  React.useEffect(() => {
    if (!data) return;
    setClientes((antes) => {
      let mudou = false;
      const novo = new Map(antes);
      for (const o of data.obras) {
        if (o.empresaId && o.empresa && !novo.has(o.empresaId)) {
          novo.set(o.empresaId, o.empresa);
          mudou = true;
        }
      }
      return mudou ? novo : antes;
    });
  }, [data]);

  async function exportar(formato: "xlsx" | "pdf") {
    if (!query) return;
    setBaixando(formato);
    try {
      await baixar(
        `/admin/relatorios/resultado-obra/exportar?${query}&formato=${formato}`,
        `resultado-por-obra-${de}_${ate}.${formato}`,
      );
    } finally {
      setBaixando(null);
    }
  }

  const linhas = React.useMemo(() => {
    if (!data) return [];
    const l = [...data.obras];
    l.sort((a, b) => {
      const va = valorDaColuna(a, ordem.coluna);
      const vb = valorDaColuna(b, ordem.coluna);
      const cmp = typeof va === "string" ? va.localeCompare(String(vb), "pt-BR") : va - (vb as number);
      return ordem.desc ? -cmp : cmp;
    });
    // "Sem obra" não é obra: fica sempre por último, fora da ordenação.
    if (data.semObra) l.push(data.semObra);
    return l;
  }, [data, ordem]);

  function ordenarPor(c: Coluna) {
    setOrdem((o) => (o.coluna === c ? { coluna: c, desc: !o.desc } : { coluna: c, desc: c !== "obra" && c !== "empresa" && c !== "margem" && c !== "margemPct" }));
  }

  const t = data?.total;
  const avisos = t ? frasesDeAviso(t.avisos, t.semPreco.custo) : [];
  const conf = data?.conferencia;
  const fechaComLucro =
    t && conf
      ? Math.abs(Number(t.custo) - Number(conf.gastouLucro)) < 0.05 &&
        Math.abs(Number(t.receita.frete) + Number(t.receita.pedagio) - Number(conf.faturouLucro)) < 0.05
      : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resultado por obra</h1>
          <p className="text-sm text-muted-foreground">
            O que cada obra rendeu menos o que custou levar a carga dela no período.
          </p>
        </div>
        {podeExportar && (
          <div className="flex flex-wrap gap-2">
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
          </div>
        )}
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarFilterDateRange state={state} label="Período" />
          <PeriodoPresets de={de} ate={ate} onChange={(p) => state.setFilters({ ...f, ...p })} />
          <Select
            aria-label="Cliente"
            className="h-9 w-full sm:w-56"
            value={empresaId ?? ""}
            onChange={(e) => state.setFilters({ ...f, empresaId: e.target.value || undefined })}
          >
            <option value="">Todos os clientes</option>
            {[...clientes.entries()]
              .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
              .map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
          </Select>
        </div>
      </Card>

      {!isLoading && error && <ErroCard erro={error} onRetry={() => void refetch()} />}
      {isLoading && <LoadingCard />}

      {data && t && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Wallet}
              label="Receita"
              value={fmtBRL(t.receita.total)}
              subtitle={`${t.obras} obra(s) · ${t.viagens} viagens · ${fmtTon(t.toneladas)} t`}
              info="Frete e pedágio repassado (o valor de cada viagem), mais a estadia que já entrou em fatura."
            />
            <StatCard
              icon={TrendingDown}
              label="Custo"
              value={fmtBRL(t.custo)}
              info="Motorista e pedágio de cada viagem, mais o custo do caminhão (diesel, manutenção, custos fixos…) dividido pelo km que cada obra rodou nele."
            />
            <StatCard
              icon={TrendingUp}
              label="Margem"
              value={fmtBRL(t.margem)}
              tone={Number(t.margem) < 0 ? "danger" : "success"}
            />
            <StatCard
              icon={Percent}
              label="Margem %"
              value={margemTexto(t.margemPct)}
              info="Quanto sobra de cada R$ 100 de receita."
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

          {linhas.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma viagem com obra no período.
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              {/* No celular o cabeçalho some (vira cartão): a ordem sai daqui. */}
              <div className="flex items-center gap-2 border-b p-3 md:hidden">
                <span className="text-sm text-muted-foreground">Ordenar por</span>
                <Select
                  aria-label="Ordenar por"
                  className="h-9 flex-1"
                  value={`${ordem.coluna}:${ordem.desc ? "desc" : "asc"}`}
                  onChange={(e) => {
                    const [coluna, sentido] = e.target.value.split(":");
                    setOrdem({ coluna: coluna as Coluna, desc: sentido === "desc" });
                  }}
                >
                  <option value="margem:asc">Pior margem primeiro</option>
                  <option value="margem:desc">Melhor margem primeiro</option>
                  <option value="receita:desc">Maior receita</option>
                  <option value="toneladas:desc">Mais toneladas</option>
                  <option value="obra:asc">Nome da obra</option>
                </Select>
              </div>
              <div className="overflow-x-auto">
                <table className="tabela-cartoes w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      {COLUNAS.map((c) => {
                        const ativa = ordem.coluna === c.chave;
                        const Icone = ativa ? (ordem.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
                        return (
                          <th
                            key={c.chave}
                            className={cn("px-3 py-2 font-medium", c.num ? "text-right" : "text-left")}
                            aria-sort={ativa ? (ordem.desc ? "descending" : "ascending") : "none"}
                          >
                            <button
                              type="button"
                              onClick={() => ordenarPor(c.chave)}
                              className={cn(
                                "inline-flex items-center gap-1 hover:text-foreground",
                                c.num && "flex-row-reverse",
                                !ativa && "text-muted-foreground",
                              )}
                            >
                              {c.rotulo}
                              <Icone className="h-3.5 w-3.5" />
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr
                        key={l.chave}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                        onClick={() => setAberta(l)}
                      >
                        <td data-mobile="titulo" className="px-3 py-2">
                          <span className={cn("font-medium", !l.clienteId && "italic text-muted-foreground")}>
                            {l.obra}
                          </span>
                          {l.semPreco.viagens > 0 && (
                            <span className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                              {l.semPreco.viagens} sem preço
                            </span>
                          )}
                        </td>
                        <td data-rotulo="Cliente" className="px-3 py-2 text-muted-foreground">
                          {l.empresa ?? "—"}
                        </td>
                        <td data-rotulo="Viagens" className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {l.viagens}
                        </td>
                        <td data-rotulo="Toneladas" className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {fmtTon(l.toneladas)}
                        </td>
                        <td data-rotulo="Receita" className="px-3 py-2 text-right tabular-nums">
                          {fmtBRL(l.receita.total)}
                        </td>
                        <td data-rotulo="Custo" className="px-3 py-2 text-right tabular-nums">
                          {fmtBRL(l.custo)}
                        </td>
                        <td
                          data-rotulo="Margem"
                          className={cn("px-3 py-2 text-right font-semibold tabular-nums", corDaMargem(l.margem))}
                        >
                          {fmtBRL(l.margem)}
                        </td>
                        <td
                          data-rotulo="Margem %"
                          className={cn("px-3 py-2 text-right tabular-nums", l.margemPct != null && l.margemPct < 0 && "text-red-700")}
                        >
                          {margemTexto(l.margemPct)}
                        </td>
                      </tr>
                    ))}
                    {data.parado && (
                      <tr className="border-b bg-muted/20 last:border-0">
                        <td data-mobile="titulo" className="px-3 py-2">
                          <span className="italic text-muted-foreground">Caminhão parado</span>
                          <p className="text-xs text-muted-foreground">
                            Sem viagem no período: {data.parado.caminhoes.map((c) => c.placa).join(", ")}
                          </p>
                        </td>
                        <td data-mobile="oculta" />
                        <td data-mobile="oculta" />
                        <td data-mobile="oculta" />
                        <td data-mobile="oculta" />
                        <td data-rotulo="Custo" className="px-3 py-2 text-right tabular-nums">
                          {fmtBRL(data.parado.custo)}
                        </td>
                        <td data-rotulo="Margem" className="px-3 py-2 text-right font-semibold tabular-nums text-red-700">
                          {fmtBRL(String(-Number(data.parado.custo)))}
                        </td>
                        <td data-mobile="oculta" />
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 bg-muted/40 font-semibold">
                    <tr>
                      <td data-mobile="titulo" className="px-3 py-2">Total</td>
                      <td data-mobile="oculta" />
                      <td data-rotulo="Viagens" className="px-3 py-2 text-right tabular-nums">{t.viagens}</td>
                      <td data-rotulo="Toneladas" className="px-3 py-2 text-right tabular-nums">{fmtTon(t.toneladas)}</td>
                      <td data-rotulo="Receita" className="px-3 py-2 text-right tabular-nums">{fmtBRL(t.receita.total)}</td>
                      <td data-rotulo="Custo" className="px-3 py-2 text-right tabular-nums">{fmtBRL(t.custo)}</td>
                      <td data-rotulo="Margem" className={cn("px-3 py-2 text-right tabular-nums", corDaMargem(t.margem))}>
                        {fmtBRL(t.margem)}
                      </td>
                      <td data-rotulo="Margem %" className="px-3 py-2 text-right tabular-nums">{margemTexto(t.margemPct)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}

          <div className="space-y-1 text-xs text-muted-foreground">
            <p>
              Motorista e pedágio são de cada viagem. Combustível e o resto do caminhão (manutenção,
              multas, custos fixos, contas) são divididos pelo km que cada obra rodou nele.
            </p>
            {conf && (
              <p>
                Lucro por caminhão no mesmo período: faturou {fmtBRL(conf.faturouLucro)}, gastou{" "}
                {fmtBRL(conf.gastouLucro)}
                {Number(t.receita.estadia) > 0 && ` (lá a estadia de ${fmtBRL(t.receita.estadia)} não entra)`}.{" "}
                {fechaComLucro ? "Os dois relatórios fecham." : "Diferença de arredondamento de centavos."}
                {podeVerLucro && (
                  <>
                    {" "}
                    <Link href={"/lucro" as Route} className="text-blue-700 underline-offset-2 hover:underline">
                      Abrir lucro por caminhão
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
        </>
      )}

      <DetalheObra
        linha={aberta}
        de={de}
        ate={ate}
        onFechar={() => setAberta(null)}
      />
    </div>
  );
}

function Linha({
  rotulo,
  valor,
  forte,
  negativo,
}: {
  rotulo: string;
  valor: string;
  forte?: boolean;
  negativo?: boolean;
}) {
  const zero = Number(valor) === 0;
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1", forte && "font-semibold")}>
      <span className={cn(zero && !forte && "text-muted-foreground")}>{rotulo}</span>
      <span className={cn("shrink-0 whitespace-nowrap tabular-nums", zero && !forte && "text-muted-foreground")}>
        {negativo && !zero ? "− " : ""}
        {fmtBRL(valor)}
      </span>
    </div>
  );
}

/** Quantas viagens a gaveta desenha. Mais que isso é trabalho de planilha. */
const MAX_VIAGENS = 200;

function DetalheObra({
  linha,
  de,
  ate,
  onFechar,
}: {
  linha: LinhaResultadoObra | null;
  de?: string;
  ate?: string;
  onFechar: () => void;
}) {
  // A lista de viagens vem à parte: a tabela não carrega milhares de viagens
  // que ninguém vai abrir.
  const path =
    linha && de && ate
      ? `/admin/relatorios/resultado-obra/obra?${new URLSearchParams({ de, ate, obra: linha.chave })}`
      : undefined;
  const { data: det, isLoading } = useApiQuery<LinhaResultadoObraDetalhe>(path, { staleTime: 30_000 });
  const avisos = linha ? frasesDeAviso(linha.avisos, linha.semPreco.custo) : [];

  return (
    <Sheet open={linha != null} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {linha && (
          <>
            <SheetHeader>
              <SheetTitle>
                {linha.obra}
                {linha.empresa && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">{linha.empresa}</span>
                )}
              </SheetTitle>
            </SheetHeader>

            <div className="mt-4 space-y-5 text-sm">
              <p className="text-muted-foreground">
                {linha.viagens} viagens · {fmtTon(linha.toneladas)} t ·{" "}
                {Number(linha.km).toLocaleString("pt-BR")} km
              </p>

              <div>
                <Linha rotulo="Receita" valor={linha.receita.total} forte />
                <div className="mt-1 border-l-2 pl-3">
                  <Linha rotulo="Frete" valor={linha.receita.frete} />
                  <Linha rotulo="Pedágio repassado ao cliente" valor={linha.receita.pedagio} />
                  <Linha rotulo="Estadia faturada" valor={linha.receita.estadia} />
                </div>

                <div className="mt-3">
                  <Linha rotulo="Custo direto da viagem" valor={linha.custoDireto} forte negativo />
                  <div className="mt-1 border-l-2 pl-3">
                    {DIRETOS.map((k) => (
                      <Linha key={k} rotulo={ROTULO_CUSTO[k]} valor={linha.custos[k]} negativo />
                    ))}
                  </div>
                </div>
                <div className="mt-3">
                  <Linha rotulo="Custo do caminhão (dividido pelo km)" valor={linha.custoRateado} forte negativo />
                  <div className="mt-1 border-l-2 pl-3">
                    {RATEADOS.map((k) => (
                      <Linha key={k} rotulo={ROTULO_CUSTO[k]} valor={linha.custos[k]} negativo />
                    ))}
                  </div>
                </div>

                <div className="mt-2 border-t pt-2">
                  <Linha rotulo="Custo" valor={linha.custo} />
                  <div
                    className={cn(
                      "flex items-baseline justify-between py-1 text-base font-semibold",
                      corDaMargem(linha.margem),
                    )}
                  >
                    <span>Margem</span>
                    <span className="tabular-nums">
                      {fmtBRL(linha.margem)}
                      <span className="ml-2 text-sm font-normal">{margemTexto(linha.margemPct)}</span>
                    </span>
                  </div>
                </div>
              </div>

              {(linha.porTonelada || linha.porViagem) && (
                <div className="grid grid-cols-2 gap-3">
                  {linha.porTonelada && (
                    <div className="rounded-md border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Por tonelada</p>
                      <p className="mt-1 tabular-nums">Receita <span className="whitespace-nowrap">{fmtBRL(linha.porTonelada.receita)}</span></p>
                      <p className="tabular-nums">Custo <span className="whitespace-nowrap">{fmtBRL(linha.porTonelada.custo)}</span></p>
                      <p className={cn("font-semibold tabular-nums", corDaMargem(linha.porTonelada.margem))}>
                        Margem <span className="whitespace-nowrap">{fmtBRL(linha.porTonelada.margem)}</span>
                      </p>
                    </div>
                  )}
                  {linha.porViagem && (
                    <div className="rounded-md border p-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Por viagem</p>
                      <p className="mt-1 tabular-nums">Receita <span className="whitespace-nowrap">{fmtBRL(linha.porViagem.receita)}</span></p>
                      <p className="tabular-nums">Custo <span className="whitespace-nowrap">{fmtBRL(linha.porViagem.custo)}</span></p>
                      <p className={cn("font-semibold tabular-nums", corDaMargem(linha.porViagem.margem))}>
                        Margem <span className="whitespace-nowrap">{fmtBRL(linha.porViagem.margem)}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {avisos.length > 0 && (
                <div className="space-y-1 rounded-md border-l-4 border-l-amber-500 bg-amber-50 p-3 dark:bg-amber-950/30">
                  {avisos.map((a) => (
                    <p key={a.texto}>{a.texto}</p>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Viagens</p>
                {isLoading && <p className="text-muted-foreground">Carregando viagens…</p>}
                {det && (
                  <>
                    <ul className="divide-y rounded-md border">
                      {det.viagensLista.slice(0, MAX_VIAGENS).map((v) => (
                        <li key={v.id}>
                          <Link
                            href={`/viagens/${v.id}` as Route}
                            className="flex items-baseline justify-between gap-3 px-3 py-1.5 hover:bg-muted/40"
                          >
                            <span className="min-w-0 truncate">
                              <span className="mr-1.5 text-xs text-muted-foreground">
                                {v.data.split("-").reverse().join("/")}
                              </span>
                              {v.placa}
                              {v.ticket && <span className="ml-1.5 text-xs text-muted-foreground">#{v.ticket}</span>}
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                {fmtTon(v.toneladas)} t · {Number(v.km).toLocaleString("pt-BR")} km
                              </span>
                              {v.semPreco && (
                                <span className="ml-1.5 rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                                  sem preço
                                </span>
                              )}
                            </span>
                            <span className={cn("shrink-0 tabular-nums", corDaMargem(v.margem))}>
                              {fmtBRL(v.margem)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {det.viagensLista.length > MAX_VIAGENS && (
                      <p className="text-xs text-muted-foreground">
                        Mostrando {MAX_VIAGENS} de {det.viagensLista.length}. A lista inteira sai no Excel.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      O número de cada viagem é a margem dela: receita menos o custo direto e a parte do
                      caminhão que coube a ela.
                    </p>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
