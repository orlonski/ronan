"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Hourglass, Route as RotaIcone, Timer } from "lucide-react";
import { RequerTela } from "@/components/requer-tela";
import { Card } from "@/components/ui/card";
import { LoadingCard } from "@/components/loading";
import { StatCard } from "@/components/stat-card";
import { PeriodoPresets } from "../_components/periodo-presets";
import { RelatorioTabs } from "../_components/relatorio-tabs";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP } from "@/lib/datetime-br";

/**
 * Ciclo da carga: em qual pedreira e em qual obra o caminhão fica parado. A
 * conta mora em `apps/api/src/common/ciclo-carga.ts`.
 *
 * Mediana e não média: uma fila de 4 horas no meio de cem cargas de 20 minutos
 * puxaria a média pra cima e esconderia o normal. O p90 ("em 1 de cada 10
 * vezes passa disto") é onde a fila aparece.
 */

type Linha = { chave: string; nome: string; viagens: number; medianaMin: number; p90Min: number };

type Resposta = {
  viagens: number;
  comMarcos: number;
  total: { medianaMin: number; p90Min: number } | null;
  naCarga: Linha[];
  naDescarga: Linha[];
  noTrajeto: Linha[];
};

function tempo(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export default function RelatorioCicloPage() {
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
    queryKey: ["relatorio-ciclo", de, ate],
    enabled: Boolean(token && de && ate),
    queryFn: () => fetchApi<Resposta>(`/admin/relatorios/ciclo?de=${de}&ate=${ate}`, { token: token! }),
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ciclo da carga</h1>
        <p className="text-sm text-muted-foreground">
          Quanto tempo o caminhão fica em cada pedreira, no caminho e em cada obra.
        </p>
      </header>

      <RelatorioTabs de={de} ate={ate} />

      <Card className="p-3">
        <PeriodoPresets
          de={de}
          ate={ate}
          onChange={(p) => {
            state.setFilter("de", p.de);
            state.setFilter("ate", p.ate);
          }}
        />
      </Card>

      {error && <Card className="border-l-4 border-l-red-500 p-4 text-sm">{(error as Error).message}</Card>}
      {isLoading && <LoadingCard />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={Hourglass}
              label="Ciclo típico"
              value={data.total ? tempo(data.total.medianaMin) : "—"}
              subtitle={data.total ? `1 em cada 10 passa de ${tempo(data.total.p90Min)}` : undefined}
              info="Da chegada na carga até descarregar, pela mediana: metade das viagens leva menos que isto."
            />
            <StatCard
              icon={Timer}
              label="Viagens medidas"
              value={data.comMarcos}
              subtitle={`de ${data.viagens} viagens guiadas`}
              info="Só a viagem iniciada pelo app tem os horários de cada fase. A lançada de uma vez só não entra."
            />
            <StatCard
              icon={RotaIcone}
              label="Locais medidos"
              value={data.naCarga.length + data.naDescarga.length}
              subtitle={`${data.naCarga.length} de carga · ${data.naDescarga.length} de descarga`}
            />
          </div>

          {data.comMarcos === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Nenhuma viagem com os horários de carga e descarga no período. Os horários vêm da viagem
              iniciada pelo app (Cheguei na carga, Saí da carga, Cheguei na descarga, Descarreguei).
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <TabelaCiclo titulo="Tempo na carga" vazio="Sem chegada e saída da carga marcadas." linhas={data.naCarga} />
              <TabelaCiclo titulo="Tempo na descarga" vazio="Sem chegada e descarga marcadas." linhas={data.naDescarga} />
              <div className="lg:col-span-2">
                <TabelaCiclo titulo="Tempo no caminho" vazio="Sem saída da carga e chegada na descarga marcadas." linhas={data.noTrajeto} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TabelaCiclo({ titulo, vazio, linhas }: { titulo: string; vazio: string; linhas: Linha[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <h2 className="border-b px-4 py-3 text-sm font-semibold">{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabela-cartoes w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Local</th>
                <th className="px-3 py-2 text-right font-medium">Viagens</th>
                <th className="px-3 py-2 text-right font-medium">Normal</th>
                <th className="px-3 py-2 text-right font-medium">Nos piores dias</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} className="border-b last:border-0">
                  <td data-mobile="titulo" className="px-3 py-2 font-medium">{l.nome}</td>
                  <td data-rotulo="Viagens" className="px-3 py-2 text-right tabular-nums text-muted-foreground">{l.viagens}</td>
                  <td data-rotulo="Normal" className="px-3 py-2 text-right tabular-nums">{tempo(l.medianaMin)}</td>
                  <td data-rotulo="Nos piores dias" className="px-3 py-2 text-right tabular-nums">{tempo(l.p90Min)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">
        "Normal" é a mediana (metade das vezes leva menos). "Nos piores dias" é o tempo que só 1 em cada 10
        vezes passa.
      </p>
    </Card>
  );
}
