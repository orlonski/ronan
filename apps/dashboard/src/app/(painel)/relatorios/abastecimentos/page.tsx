"use client";

import * as React from "react";
import { Banknote, Download, Droplet, FileSpreadsheet, Gauge, ListChecks } from "lucide-react";
import {
  AGRUPAR_POR_ABASTECIMENTO_LABEL,
  type AgruparPorAbastecimento,
  type GrupoRelatorioAbastecimentos,
  type RelatorioAbastecimentosResposta,
  TIPO_COMBUSTIVEL_LABEL,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { InfoHint } from "@/components/ui/info-hint";
import { LoadingCard } from "@/components/loading";
import { RequerTela } from "@/components/requer-tela";
import { StatCard } from "@/components/stat-card";
import { DataTableToolbar, ToolbarFilterDateRange } from "@/components/data-table";
import {
  MotoristaCombobox,
  TransportadoraCombobox,
  VeiculoCombobox,
} from "@/components/fk-comboboxes";
import { useApiQuery, useResourceOptions } from "@/lib/client-api";
import { useBaixarArquivo } from "@/lib/fechamentos-api";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { usePermissoes } from "@/lib/permissoes";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP } from "@/lib/datetime-br";
import { fmtBRL, fmtNum } from "@/lib/fechamento-helpers";
import { PeriodoPresets } from "../_components/periodo-presets";
import { RelatorioTabs } from "../_components/relatorio-tabs";
import { DetalheGrupoAbastecimentoSheet } from "../_components/detalhe-grupo-abastecimento-sheet";

const DIMENSOES: AgruparPorAbastecimento[] = [
  "MOTORISTA",
  "VEICULO",
  "POSTO",
  "TIPO",
  "EMPRESA",
  "TRANSPORTADORA",
];

/** Chaves de filtro que viram query string da API (fora `de`/`ate`). */
const CHAVES_FILTRO = [
  "motoristaId",
  "veiculoId",
  "empresaId",
  "transportadoraId",
  "tipo",
] as const;

const OPCOES_COMBUSTIVEL = Object.entries(TIPO_COMBUSTIVEL_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export default function RelatorioAbastecimentosPage() {
  return (
    <RequerTela chave="relatorios.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const { temPermissao } = usePermissoes();
  const podeExportar = temPermissao("relatorios.exportar");
  // Mesmo critério da tela de Abastecimentos: o filtro por empresa depende da
  // permissão do recurso, não do escopo de frota.
  const podeVerEmpresa = temPermissao("empresas.ver");
  const baixar = useBaixarArquivo();
  const [baixando, setBaixando] = React.useState<"xlsx" | "pdf" | null>(null);
  const [grupoAberto, setGrupoAberto] = React.useState<GrupoRelatorioAbastecimentos | null>(null);

  const state = useDataTableState({
    defaultFilters: {
      de: primeiroDiaDoMesSP(),
      ate: ultimoDiaDoMesSP(),
      agruparPor: "MOTORISTA",
    },
  });

  const f = state.filters;
  const agruparPor = (f.agruparPor as AgruparPorAbastecimento) ?? "MOTORISTA";
  const de = f.de;
  const ate = f.ate;

  const empresas = useResourceOptions<{ id: string; nome: string }>("/admin/empresas", {
    enabled: podeVerEmpresa,
  });
  const opcoesEmpresa = React.useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const query = React.useMemo(() => {
    if (!de || !ate) return undefined;
    const p = new URLSearchParams({ de, ate, agruparPor });
    for (const k of CHAVES_FILTRO) {
      const v = f[k];
      if (v) p.set(k, v);
    }
    return p.toString();
  }, [de, ate, agruparPor, f]);

  const { data, isLoading, isFetching, error } = useApiQuery<RelatorioAbastecimentosResposta>(
    query ? `/admin/relatorios/abastecimentos?${query}` : undefined,
    { staleTime: 30_000 },
  );

  async function exportar(formato: "xlsx" | "pdf") {
    if (!query) return;
    setBaixando(formato);
    try {
      await baixar(
        `/admin/relatorios/abastecimentos/exportar?${query}&formato=${formato}`,
        `relatorio-abastecimentos-${de}_${ate}.${formato}`,
      );
    } finally {
      setBaixando(null);
    }
  }

  const t = data?.totais;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">
            Combustível do período, agrupado como você precisar.
          </p>
        </div>
        {podeExportar && (
          <div className="flex gap-2">
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

      <RelatorioTabs de={de} ate={ate} />

      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarFilterDateRange state={state} label="Período" />
          <PeriodoPresets de={de} ate={ate} onChange={(p) => state.setFilters({ ...f, ...p })} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="mr-1 text-xs text-muted-foreground">Agrupar por:</span>
          {DIMENSOES.filter((d) => d !== "EMPRESA" || podeVerEmpresa).map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={agruparPor === d ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => state.setFilter("agruparPor", d)}
            >
              {AGRUPAR_POR_ABASTECIMENTO_LABEL[d]}
            </Button>
          ))}
        </div>

        <DataTableToolbar
          state={state}
          hideSearch
          filters={
            <>
              <MotoristaCombobox
                value={f.motoristaId}
                onChange={(v) => state.setFilter("motoristaId", v)}
                placeholder="Motorista"
              />
              <VeiculoCombobox
                value={f.veiculoId}
                onChange={(v) => state.setFilter("veiculoId", v)}
                placeholder="Veículo"
              />
              <Combobox
                value={f.tipo ?? ""}
                onChange={(v) => state.setFilter("tipo", v || undefined)}
                options={OPCOES_COMBUSTIVEL}
                showSearch={false}
                placeholder="Combustível"
                className="w-[170px]"
              />
              {podeVerEmpresa && (
                <Combobox
                  value={f.empresaId ?? ""}
                  onChange={(v) => state.setFilter("empresaId", v || undefined)}
                  options={opcoesEmpresa}
                  placeholder="Empresa"
                  className="w-[180px]"
                />
              )}
              <TransportadoraCombobox
                value={f.transportadoraId}
                onChange={(v) => state.setFilter("transportadoraId", v)}
                placeholder="Frota"
              />
            </>
          }
        />
      </Card>

      {error && (
        <Card className="border-l-4 border-l-red-500 p-4 text-sm">{(error as Error).message}</Card>
      )}

      {isLoading && <LoadingCard />}

      {data && t && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <StatCard
              icon={ListChecks}
              label="Abastecimentos"
              value={t.abastecimentos}
              subtitle={t.semValor ? `${t.semValor} sem valor informado` : undefined}
              tone="info"
            />
            <StatCard
              icon={Droplet}
              label="Litros"
              value={fmtNum(Number(t.litros), 3)}
              tone="default"
            />
            <StatCard
              icon={Banknote}
              label="Valor"
              value={fmtBRL(Number(t.valor))}
              subtitle={t.emComboio ? `${t.emComboio} em comboio` : undefined}
              info="Só o que tem valor lançado. Abastecimento de comboio entra sem valor até alguém preencher — os litros contam, o custo não."
              tone="success"
            />
            <StatCard
              icon={Gauge}
              label="R$/litro médio"
              value={fmtNum(Number(t.precoMedio), 3)}
              subtitle={
                t.semValor ? `sobre ${fmtNum(Number(t.litrosComValor), 0)} L com valor` : undefined
              }
              info="Valor total dividido pelos litros que TÊM valor informado. Dividir pelo total de litros faria o comboio derrubar o preço médio."
              tone="warning"
            />
          </div>

          <TabelaResumo relatorio={data} carregando={isFetching} onAbrirGrupo={setGrupoAberto} />
        </>
      )}

      {grupoAberto && data && (
        <DetalheGrupoAbastecimentoSheet
          grupo={grupoAberto}
          agruparPor={data.agruparPor}
          filtros={{ de: de!, ate: ate!, ...filtrosAtivos(f) }}
          onFechar={() => setGrupoAberto(null)}
        />
      )}
    </div>
  );
}

function filtrosAtivos(f: Record<string, string | undefined>) {
  const out: Record<string, string> = {};
  for (const k of CHAVES_FILTRO) if (f[k]) out[k] = f[k]!;
  return out;
}

function TabelaResumo({
  relatorio,
  carregando,
  onAbrirGrupo,
}: {
  relatorio: RelatorioAbastecimentosResposta;
  carregando: boolean;
  onAbrirGrupo: (g: GrupoRelatorioAbastecimentos) => void;
}) {
  const { grupos, totais } = relatorio;

  if (grupos.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Nenhum abastecimento no período com esses filtros.
      </Card>
    );
  }

  return (
    <Card className={carregando ? "opacity-60 transition-opacity" : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">
                {AGRUPAR_POR_ABASTECIMENTO_LABEL[relatorio.agruparPor]}
              </th>
              <th className="px-3 py-2 text-right font-medium">Abastecimentos</th>
              <th className="px-3 py-2 text-right font-medium">Litros</th>
              <th className="px-3 py-2 text-right font-medium">Valor</th>
              <th className="px-3 py-2 text-right font-medium">
                R$/litro
                <InfoHint text="Valor ÷ litros com valor informado. Comboio sem valor não entra na conta." />
              </th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <tr
                key={g.chave}
                onClick={() => onAbrirGrupo(g)}
                className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
              >
                <td className="px-3 py-2">
                  <span className="font-medium">{g.nome}</span>
                  {g.detalhe && (
                    <span className="ml-1.5 text-xs text-muted-foreground">{g.detalhe}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {g.abastecimentos}
                  {/* Sem este aviso, um grupo cheio de comboio parece barato. */}
                  {!!g.semValor && (
                    <span
                      className="ml-1 text-xs text-amber-600"
                      title={`${g.semValor} sem valor informado`}
                    >
                      ({g.semValor} s/ valor)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(Number(g.litros), 3)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(Number(g.valor))}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtNum(Number(g.precoMedio), 3)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2">TOTAL</td>
              <td className="px-3 py-2 text-right tabular-nums">{totais.abastecimentos}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNum(Number(totais.litros), 3)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtBRL(Number(totais.valor))}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNum(Number(totais.precoMedio), 3)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!!totais.semValor && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          <p>
            {totais.semValor === 1
              ? "1 abastecimento entrou sem valor"
              : `${totais.semValor} abastecimentos entraram sem valor`}{" "}
            ({totais.emComboio} em comboio) — os litros contam no total, o custo não. O R$/litro
            considera só os {fmtNum(Number(totais.litrosComValor), 3)} L com valor informado.
          </p>
        </div>
      )}
    </Card>
  );
}
