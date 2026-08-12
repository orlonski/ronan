"use client";

import * as React from "react";
import { Download, FileSpreadsheet, Fuel, Route, Truck, Weight } from "lucide-react";
import {
  AGRUPAR_POR_LABEL,
  type AgruparPorRelatorio,
  DIMENSOES_COMERCIAIS,
  type GrupoRelatorioViagens,
  type RelatorioViagensResposta,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { LoadingCard } from "@/components/loading";
import { RequerTela } from "@/components/requer-tela";
import { StatCard } from "@/components/stat-card";
import { DataTableToolbar, ToolbarFilterDateRange } from "@/components/data-table";
import {
  ClienteCombobox,
  LocalCombobox,
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
import { DetalheGrupoSheet } from "../_components/detalhe-grupo-sheet";
import { Combobox } from "@/components/ui/combobox";

const DIMENSOES: AgruparPorRelatorio[] = [
  "MOTORISTA",
  "CLIENTE",
  "MATERIAL",
  "LOCAL_CARGA",
  "LOCAL_DESCARGA",
  "VEICULO",
  "EMPRESA",
  "TRANSPORTADORA",
];

/** Chaves de filtro que viram query string da API (fora `de`/`ate`). */
const CHAVES_FILTRO = [
  "motoristaId",
  "clienteId",
  "empresaId",
  "materialId",
  "localCargaId",
  "localDescargaId",
  "veiculoId",
  "transportadoraId",
] as const;

export default function RelatorioViagensPage() {
  return (
    <RequerTela chave="relatorios.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const { temPermissao } = usePermissoes();
  const verComercial = temPermissao("viagens.ver-comercial");
  const podeExportar = temPermissao("relatorios.exportar");
  const baixar = useBaixarArquivo();
  const [baixando, setBaixando] = React.useState<"xlsx" | "pdf" | null>(null);
  const [grupoAberto, setGrupoAberto] = React.useState<GrupoRelatorioViagens | null>(null);

  // Reusa o estado das listagens: sincroniza filtros com a URL e lembra a
  // escolha por tela no localStorage. Paginação/ordenação do hook não são
  // usadas aqui — o resumo vem inteiro e ordena no servidor.
  const state = useDataTableState({
    defaultFilters: {
      de: primeiroDiaDoMesSP(),
      ate: ultimoDiaDoMesSP(),
      agruparPor: "MOTORISTA",
    },
  });

  const f = state.filters;
  const agruparPor = (f.agruparPor as AgruparPorRelatorio) ?? "MOTORISTA";
  const de = f.de;
  const ate = f.ate;

  // Material é lista curta (dezenas), então o teto de 200 do useResourceOptions
  // não esconde nada — diferente de Locais/Motoristas, que exigem AsyncCombobox.
  const materiais = useResourceOptions<{ id: string; nome: string }>("/admin/materiais");
  const opcoesMaterial = React.useMemo(
    () => (materiais.data ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [materiais.data],
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

  const { data, isLoading, isFetching, error } = useApiQuery<RelatorioViagensResposta>(
    query ? `/admin/relatorios/viagens?${query}` : undefined,
    { staleTime: 30_000 },
  );

  async function exportar(formato: "xlsx" | "pdf") {
    if (!query) return;
    setBaixando(formato);
    try {
      await baixar(
        `/admin/relatorios/viagens/exportar?${query}&formato=${formato}`,
        `relatorio-viagens-${de}_${ate}.${formato}`,
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
            Produção do período, agrupada como você precisar.
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

      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarFilterDateRange state={state} label="Período" />
          <PeriodoPresets
            de={de}
            ate={ate}
            onChange={(p) => state.setFilters({ ...f, ...p })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="mr-1 text-xs text-muted-foreground">Agrupar por:</span>
          {DIMENSOES.filter((d) => verComercial || !DIMENSOES_COMERCIAIS.includes(d)).map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={agruparPor === d ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => state.setFilter("agruparPor", d)}
            >
              {AGRUPAR_POR_LABEL[d]}
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
              {verComercial && (
                <ClienteCombobox
                  value={f.clienteId}
                  onChange={(v) => state.setFilter("clienteId", v)}
                  placeholder="Cliente"
                />
              )}
              <Combobox
                value={f.materialId ?? ""}
                onChange={(v) => state.setFilter("materialId", v || undefined)}
                options={opcoesMaterial}
                placeholder="Material"
                className="w-[180px]"
              />
              <LocalCombobox
                value={f.localCargaId}
                onChange={(v) => state.setFilter("localCargaId", v)}
                placeholder="Local de carga"
              />
              <LocalCombobox
                value={f.localDescargaId}
                onChange={(v) => state.setFilter("localDescargaId", v)}
                placeholder="Local de descarga"
              />
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
        <Card className="border-l-4 border-l-red-500 p-4 text-sm">
          {(error as Error).message}
        </Card>
      )}

      {isLoading && <LoadingCard />}

      {data && t && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <StatCard icon={Truck} label="Viagens" value={t.viagens} tone="info" />
            <StatCard
              icon={Weight}
              label={verComercial ? "Toneladas faturadas" : "Toneladas"}
              value={fmtNum(Number(verComercial ? t.toneladasEfetiva : t.toneladas), 3)}
              subtitle={
                verComercial && t.toneladasAjustadas
                  ? `${t.toneladasAjustadas} viagens no mínimo`
                  : undefined
              }
              info={
                verComercial
                  ? "Mínimo por faixa aplicado, igual ao fechamento. O real lançado aparece na tabela."
                  : undefined
              }
              tone="success"
            />
            <StatCard
              icon={Route}
              label={verComercial ? "Km faturado" : "Km"}
              value={fmtNum(Number(verComercial ? t.kmEfetivo : t.km), 2)}
              subtitle={
                verComercial && t.kmAjustados ? `${t.kmAjustados} viagens no mínimo` : undefined
              }
              tone="default"
            />
            <StatCard
              icon={Fuel}
              label="Pedágio"
              value={fmtBRL(Number(t.pedagio))}
              subtitle={
                t.viagensSemPedagio ? `${t.viagensSemPedagio} viagens sem informar` : undefined
              }
              info="Soma do total de pedágio lançado na viagem — a mesma fonte que o fechamento fatura. Os lançamentos praça a praça são contados à parte, no rodapé."
              tone="warning"
            />
          </div>

          <TabelaResumo
            relatorio={data}
            carregando={isFetching}
            onAbrirGrupo={setGrupoAberto}
          />
        </>
      )}

      {grupoAberto && data && (
        <DetalheGrupoSheet
          grupo={grupoAberto}
          agruparPor={data.agruparPor}
          filtros={{ de: de!, ate: ate!, ...filtrosAtivos(f) }}
          verComercial={verComercial}
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
  relatorio: RelatorioViagensResposta;
  carregando: boolean;
  onAbrirGrupo: (g: GrupoRelatorioViagens) => void;
}) {
  const { grupos, totais, comercial } = relatorio;

  if (grupos.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Nenhuma viagem no período com esses filtros.
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
                {AGRUPAR_POR_LABEL[relatorio.agruparPor]}
              </th>
              <th className="px-3 py-2 text-right font-medium">Viagens</th>
              <th className="px-3 py-2 text-right font-medium">Toneladas</th>
              {comercial && (
                <th className="px-3 py-2 text-right font-medium">
                  Ton. faturada
                  <InfoHint text="Mínimo por faixa aplicado. O real fica na coluna ao lado." />
                </th>
              )}
              <th className="px-3 py-2 text-right font-medium">Km</th>
              {comercial && <th className="px-3 py-2 text-right font-medium">Km faturado</th>}
              <th className="px-3 py-2 text-right font-medium">Pedágio</th>
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
                <td className="px-3 py-2 text-right tabular-nums">{g.viagens}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtNum(Number(g.toneladas), 3)}
                </td>
                {comercial && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtNum(Number(g.toneladasEfetiva ?? 0), 3)}
                    {!!g.toneladasAjustadas && (
                      <span className="ml-1 text-xs text-amber-600">↑</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums">{fmtNum(Number(g.km), 2)}</td>
                {comercial && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtNum(Number(g.kmEfetivo ?? 0), 2)}
                    {!!g.kmAjustados && <span className="ml-1 text-xs text-amber-600">↑</span>}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtBRL(Number(g.pedagio))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2">TOTAL</td>
              <td className="px-3 py-2 text-right tabular-nums">{totais.viagens}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNum(Number(totais.toneladas), 3)}
              </td>
              {comercial && (
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtNum(Number(totais.toneladasEfetiva ?? 0), 3)}
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNum(Number(totais.km), 2)}
              </td>
              {comercial && (
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtNum(Number(totais.kmEfetivo ?? 0), 2)}
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtBRL(Number(totais.pedagio))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Sem isto, alguém soma o pedágio da tabela com os lançamentos da tela de
          Pedágios e acha que falta dinheiro. São fontes diferentes do mesmo fato. */}
      <div className="space-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
        <p>
          Lançamentos de pedágio praça a praça no período —{" "}
          <strong>fonte separada, não somar ao total acima</strong>: vinculados a viagem{" "}
          {fmtBRL(Number(relatorio.pedagioReconciliacao.lancamentosVinculados))} · avulsos{" "}
          {fmtBRL(Number(relatorio.pedagioReconciliacao.lancamentosAvulsos))}.
        </p>
        {/* A pergunta "por que não bate com o fechamento?" tem uma resposta só, e
            é esta. Melhor responder antes de ser perguntada. */}
        {!!totais.viagensNaoConciliadas && (
          <p>
            {totais.viagensNaoConciliadas === 1
              ? "1 viagem conta aqui como produção mas"
              : `${totais.viagensNaoConciliadas} viagens contam aqui como produção mas`}{" "}
            não entra{totais.viagensNaoConciliadas === 1 ? "" : "m"} no XLSX de fechamento
            (divergente ou em conferência) — por isso este total pode ficar acima do envio do
            mesmo período.
          </p>
        )}
      </div>
    </Card>
  );
}
