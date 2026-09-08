"use client";

import * as React from "react";
import { BotMessageSquare, Timer, TrendingDown, UserCheck, Zap } from "lucide-react";
import {
  GRANULARIDADE_CONFERENCIA_LABEL,
  GranularidadeConferencia,
  ORIGEM_CONFERENCIA_LABEL,
  type EstatisticaTempoConferencia,
  type RelatorioConferenciaResposta,
} from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingCard } from "@/components/loading";
import { RequerTela } from "@/components/requer-tela";
import { StatCard } from "@/components/stat-card";
import { DataTableToolbar, ToolbarFilterDateRange } from "@/components/data-table";
import { TransportadoraCombobox } from "@/components/fk-comboboxes";
import {
  COR_ORIGEM,
  FaixasChart,
  TempoPorPeriodoChart,
  VolumePorPeriodoChart,
} from "@/components/conferencia-historico-chart";
import { useApiQuery } from "@/lib/client-api";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { fmtDuracaoMs, fmtDuracaoSegundos } from "@/lib/duracao";
import { PeriodoPresets, ultimos12Meses } from "../_components/periodo-presets";
import { RelatorioTabs } from "../_components/relatorio-tabs";

const GRANULARIDADES = GranularidadeConferencia.options;

export default function RelatorioConferenciaPage() {
  return (
    <RequerTela chave="relatorios.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  // Diferente das outras abas de relatório, o default aqui é o ANO, não o mês:
  // a tela existe pra comparar o antes e o depois da conferência automática, e
  // um mês sozinho não tem antes nenhum.
  const state = useDataTableState({
    defaultFilters: { ...ultimos12Meses(), granularidade: "MES" },
  });

  const f = state.filters;
  const de = f.de;
  const ate = f.ate;
  const granularidade = (f.granularidade as GranularidadeConferencia) ?? "MES";

  const query = React.useMemo(() => {
    if (!de || !ate) return undefined;
    const p = new URLSearchParams({ de, ate, granularidade });
    if (f.transportadoraId) p.set("transportadoraId", f.transportadoraId);
    return p.toString();
  }, [de, ate, granularidade, f.transportadoraId]);

  const { data, isLoading, error } = useApiQuery<RelatorioConferenciaResposta>(
    query ? `/admin/relatorios/conferencia?${query}` : undefined,
    { staleTime: 30_000 },
  );

  const humano = data?.totais.porOrigem.HUMANO;
  const ia = data?.totais.porOrigem.IA;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Quanto tempo uma viagem espera até ser conferida — e como isso mudou.
        </p>
      </div>

      <RelatorioTabs de={de} ate={ate} />

      <Card className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarFilterDateRange state={state} label="Período" />
          <PeriodoPresets de={de} ate={ate} onChange={(p) => state.setFilters({ ...f, ...p })} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="mr-1 text-xs text-muted-foreground">Agrupar por:</span>
          {GRANULARIDADES.map((g) => (
            <Button
              key={g}
              type="button"
              size="sm"
              variant={granularidade === g ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => state.setFilter("granularidade", g)}
            >
              {GRANULARIDADE_CONFERENCIA_LABEL[g]}
            </Button>
          ))}
        </div>

        <DataTableToolbar
          state={state}
          hideSearch
          filters={
            <TransportadoraCombobox
              value={f.transportadoraId}
              onChange={(v) => state.setFilter("transportadoraId", v)}
              placeholder="Frota"
            />
          }
        />
      </Card>

      {error && (
        <Card className="border-l-4 border-l-red-500 p-4 text-sm">{(error as Error).message}</Card>
      )}

      {isLoading && <LoadingCard />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Timer}
              label="Tempo mediano"
              value={fmtDuracaoSegundos(data.totais.geral.medianaSegundos)}
              subtitle={`${data.totais.total} · p90 ${fmtDuracaoSegundos(data.totais.geral.p90Segundos)}`}
              info="Da chegada da viagem no servidor até alguém (ou o robô) dar como conferida. Mediana, não média: uma viagem esquecida por semanas não distorce o número."
              tone="default"
            />
            <StatCard
              icon={UserCheck}
              label="Conferido por pessoa"
              value={fmtDuracaoSegundos(humano?.medianaSegundos)}
              subtitle={`${humano?.n ?? 0} conferências`}
              tone="info"
            />
            <StatCard
              icon={BotMessageSquare}
              label="Conferência automática"
              value={fmtDuracaoSegundos(ia?.medianaSegundos)}
              subtitle={`${ia?.n ?? 0} conferências`}
              tone="success"
            />
            <StatCard
              icon={Zap}
              label="Leitura do ticket"
              value={fmtDuracaoMs(data.leitura.medianaMs)}
              subtitle={`${data.leitura.leituras} leituras no período`}
              info="Tempo de máquina: quanto o robô leva pra ler um ticket, sem contar a fila. É outro número, não o de cima em outra unidade."
              tone="warning"
            />
          </div>

          <Comparacao humano={humano} ia={ia} />

          <Card className="space-y-3 p-4">
            <div>
              <h2 className="font-semibold">Tempo até conferir</h2>
              <p className="text-xs text-muted-foreground">
                Mediana por {granularidade === "MES" ? "mês" : "semana"}, separada por quem
                conferiu.
              </p>
            </div>
            <TempoPorPeriodoChart periodos={data.periodos} />
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="space-y-3 p-4">
              <div>
                <h2 className="font-semibold">Quem conferiu</h2>
                <p className="text-xs text-muted-foreground">
                  Volume por {granularidade === "MES" ? "mês" : "semana"}.
                </p>
              </div>
              <VolumePorPeriodoChart periodos={data.periodos} />
            </Card>

            <Card className="space-y-3 p-4">
              <div>
                <h2 className="font-semibold">Distribuição do tempo</h2>
                <p className="text-xs text-muted-foreground">
                  Todo o período. A cauda de dias é o que a mediana esconde.
                </p>
              </div>
              <FaixasChart faixas={data.faixas} />
            </Card>
          </div>

          <TabelaPeriodos data={data} />
        </>
      )}
    </div>
  );
}

/**
 * A frase que a tela existe pra dizer. Só aparece quando os dois lados têm
 * conferência no período — sem o "antes" não há comparação, e inventar uma
 * porcentagem em cima de zero seria pior que não mostrar nada.
 */
function Comparacao({
  humano,
  ia,
}: {
  humano?: EstatisticaTempoConferencia;
  ia?: EstatisticaTempoConferencia;
}) {
  const h = humano?.medianaSegundos;
  const i = ia?.medianaSegundos;
  if (!h || i == null || !humano?.n || !ia?.n) return null;
  if (i >= h) return null;

  // Acima de 2× a porcentagem para de informar: "99% menos tempo" e "100% menos
  // tempo" são a mesma frase pra quem lê, e a segunda ainda soa como zero. A
  // razão diz a mesma coisa sem arredondar a diferença pra fora.
  const vezes = i > 0 ? h / i : null;
  const frase =
    vezes && vezes >= 2 ? (
      <>
        foi <strong>{Math.round(vezes)}× mais rápida</strong> que a conferência por pessoa
      </>
    ) : (
      <>
        levou <strong>{Math.round((1 - i / h) * 100)}% menos tempo</strong> que a conferência por
        pessoa
      </>
    );

  return (
    <Card className="flex items-start gap-3 border-l-4 border-l-green-500 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-green-100">
        <TrendingDown className="h-5 w-5 text-green-700" />
      </div>
      <div className="text-sm">
        <p>
          No período, a conferência automática {frase} — {fmtDuracaoSegundos(i)} contra{" "}
          {fmtDuracaoSegundos(h)} na mediana.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Comparação entre as viagens de cada lado no mesmo recorte, não entre períodos: as duas
          convivem, e o que muda é a fatia que cada uma pega.
        </p>
      </div>
    </Card>
  );
}

function TabelaPeriodos({ data }: { data: RelatorioConferenciaResposta }) {
  const comDados = data.periodos.filter((p) => p.total > 0);

  if (comDados.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        Nenhuma viagem conferida no período com esses filtros.
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Período</th>
              <th className="px-3 py-2 text-right font-medium">Conferências</th>
              <th className="px-3 py-2 text-right font-medium">Mediana</th>
              <th className="px-3 py-2 text-right font-medium">Dia ruim (p90)</th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${COR_ORIGEM.HUMANO}`} />
                  Por pessoa
                </span>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${COR_ORIGEM.IA}`} />
                  Automática
                </span>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {ORIGEM_CONFERENCIA_LABEL.DISPENSA}
              </th>
            </tr>
          </thead>
          <tbody>
            {comDados.map((p) => (
              <tr key={p.chave} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{p.rotulo}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.total}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtDuracaoSegundos(p.geral.medianaSegundos)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {fmtDuracaoSegundos(p.geral.p90Segundos)}
                </td>
                <CelulaOrigem stat={p.porOrigem.HUMANO} />
                <CelulaOrigem stat={p.porOrigem.IA} />
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {p.porOrigem.DISPENSA.n || "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 bg-muted/30 font-semibold">
            <tr>
              <td className="px-3 py-2">TOTAL</td>
              <td className="px-3 py-2 text-right tabular-nums">{data.totais.total}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtDuracaoSegundos(data.totais.geral.medianaSegundos)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtDuracaoSegundos(data.totais.geral.p90Segundos)}
              </td>
              <CelulaOrigem stat={data.totais.porOrigem.HUMANO} />
              <CelulaOrigem stat={data.totais.porOrigem.IA} />
              <td className="px-3 py-2 text-right tabular-nums">
                {data.totais.porOrigem.DISPENSA.n || "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        &quot;{ORIGEM_CONFERENCIA_LABEL.DISPENSA}&quot; entra na conta de volume mas fica fora da
        comparação de tempo: são viagens de material que não gera ticket (concreto e afins), que
        nascem aprovadas — o tempo delas é zero por definição e faria o robô parecer mais rápido do
        que é.
      </p>
    </Card>
  );
}

function CelulaOrigem({ stat }: { stat: EstatisticaTempoConferencia }) {
  if (stat.n === 0) {
    return <td className="px-3 py-2 text-right text-muted-foreground">—</td>;
  }
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {fmtDuracaoSegundos(stat.medianaSegundos)}
      <span className="ml-1 text-xs font-normal text-muted-foreground">({stat.n})</span>
    </td>
  );
}
