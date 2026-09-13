"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge, TriangleAlert } from "lucide-react";
import { RequerTela } from "@/components/requer-tela";
import { Card } from "@/components/ui/card";
import { LoadingCard } from "@/components/loading";
import { StatCard } from "@/components/stat-card";
import { PeriodoPresets } from "../_components/periodo-presets";
import { RelatorioTabs } from "../_components/relatorio-tabs";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP } from "@/lib/datetime-br";

type VeiculoConsumo = {
  veiculoId: string;
  placa: string;
  modelo: string | null;
  abastecimentos: number;
  kmPorLitro: number | null;
  kmRodados: number;
  litros: number;
  gasto: string;
  custoPorKm: string | null;
  trechos: number;
  motivo: string | null;
};

type Resposta = {
  veiculos: VeiculoConsumo[];
  frota: {
    veiculosMedidos: number;
    veiculosSemMedicao: number;
    kmPorLitro: number | null;
    kmRodados: number;
    litros: number;
  };
};

function brl(v: string | number): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : String(v);
}

function num(v: number, casas = 0): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export default function RelatorioConsumoPage() {
  return (
    <RequerTela chave="relatorios.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const state = useDataTableState({
    defaultFilters: { de: primeiroDiaDoMesSP(), ate: ultimoDiaDoMesSP() },
  });
  const de = state.filters.de;
  const ate = state.filters.ate;

  const { data, isLoading, error } = useQuery({
    queryKey: ["relatorio-consumo", de, ate],
    enabled: Boolean(token && de && ate),
    queryFn: () =>
      fetchApi<Resposta>(`/admin/relatorios/consumo?de=${de}&ate=${ate}`, { token: token! }),
  });

  // O melhor consumo da frota é a régua honesta pra comparar: nada de meta
  // inventada. Quem faz 2,1 ao lado de quem faz 3,0 no mesmo pátio tem problema.
  const melhor = React.useMemo(() => {
    const medidos = (data?.veiculos ?? []).filter((v) => v.kmPorLitro != null);
    return medidos.length > 0 ? Math.max(...medidos.map((v) => v.kmPorLitro!)) : null;
  }, [data]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Consumo da frota</h1>
        <p className="text-sm text-muted-foreground">
          Quilômetros por litro de cada caminhão, medido entre dois abastecimentos de tanque
          cheio.
        </p>
      </header>

      <RelatorioTabs de={de} ate={ate} />

      <Card className="p-3">
        <PeriodoPresets
          de={de}
          ate={ate}
          onChange={(periodo) => {
            state.setFilter("de", periodo.de);
            state.setFilter("ate", periodo.ate);
          }}
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
              icon={Gauge}
              label="Média da frota"
              value={data.frota.kmPorLitro != null ? `${num(data.frota.kmPorLitro, 2)} km/l` : "—"}
              info="Ponderada pelo km rodado, não é a média das médias: um caminhão que rodou 5.000 km pesa mais que um que rodou 500."
              tone="default"
            />
            <StatCard
              icon={Gauge}
              label="Km medidos"
              value={num(data.frota.kmRodados)}
              info="Só o que está entre dois tanques cheios com odômetro anotado."
              tone="default"
            />
            <StatCard
              icon={Gauge}
              label="Litros"
              value={num(data.frota.litros, 1)}
              info="Litros queimados nos trechos medidos."
              tone="default"
            />
            <StatCard
              icon={TriangleAlert}
              label="Sem medição"
              value={data.frota.veiculosSemMedicao}
              info="Caminhões que abasteceram no período mas não deu pra medir — falta odômetro ou falta um segundo tanque cheio."
              tone={data.frota.veiculosSemMedicao > 0 ? "warning" : "default"}
            />
          </div>

          {data.veiculos.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nenhum abastecimento no período.
            </Card>
          ) : (
            <Card className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Caminhão</th>
                      <th className="px-3 py-2 text-right font-medium">km/l</th>
                      <th className="px-3 py-2 text-right font-medium">Km</th>
                      <th className="px-3 py-2 text-right font-medium">Litros</th>
                      <th className="px-3 py-2 text-right font-medium">Gasto</th>
                      <th className="px-3 py-2 text-right font-medium">R$/km</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.veiculos.map((v) => {
                      // 10% abaixo do melhor da própria frota já é dinheiro
                      // visível no fim do mês.
                      const ruim =
                        v.kmPorLitro != null && melhor != null && v.kmPorLitro < melhor * 0.9;
                      return (
                        <tr key={v.veiculoId} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            <span className="font-medium">{v.placa}</span>
                            {v.modelo && (
                              <span className="ml-1 text-xs text-muted-foreground">{v.modelo}</span>
                            )}
                            {v.motivo && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{v.motivo}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {v.kmPorLitro != null ? (
                              <span className={ruim ? "font-semibold text-amber-700" : "font-medium"}>
                                {num(v.kmPorLitro, 2)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {v.kmRodados > 0 ? num(v.kmRodados) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {v.litros > 0 ? num(v.litros, 1) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{brl(v.gasto)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {v.custoPorKm ? brl(v.custoPorKm) : "—"}
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
            A medição só é possível entre dois abastecimentos marcados como tanque cheio e com o
            odômetro anotado — é o que garante que os litros do bocal sejam exatamente os que o
            trecho gastou. Abastecimentos parciais no meio entram na conta dos litros.
          </p>
        </>
      )}
    </div>
  );
}
