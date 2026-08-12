"use client";

import * as React from "react";
import {
  AGRUPAR_POR_LABEL,
  type AgruparPorRelatorio,
  GRUPO_SEM_VALOR,
  type GrupoRelatorioViagens,
} from "@ronan/shared-types";
import Link from "next/link";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LoadingInline } from "@/components/loading";
import { usePaginatedList } from "@/lib/client-api";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { fmtBR, fmtNum } from "@/lib/fechamento-helpers";

/**
 * Drill-down de uma linha do relatório: as viagens que formaram aquele número.
 *
 * Reusa `GET /admin/viagens` em vez de um endpoint próprio — aquele já pagina,
 * aplica os mínimos e passa pelo filtro comercial. O relatório só acrescentou
 * os filtros que faltavam lá (material, empresa, frota, local de carga/descarga).
 */

/** Qual query param da listagem de viagens corresponde a cada dimensão. */
const PARAM_DA_DIMENSAO: Record<AgruparPorRelatorio, string> = {
  MOTORISTA: "motoristaId",
  CLIENTE: "clienteId",
  EMPRESA: "empresaId",
  MATERIAL: "materialId",
  LOCAL_CARGA: "localCargaId",
  LOCAL_DESCARGA: "localDescargaId",
  VEICULO: "veiculoId",
  TRANSPORTADORA: "transportadoraId",
};

type ViagemLinha = {
  id: string;
  data: string | null;
  ticket: string | null;
  status: string;
  toneladas: string | null;
  km: string | null;
  toneladasEfetiva?: string;
  kmEfetivo?: string;
  motorista?: { nome: string };
  veiculo?: { placa: string };
  cliente?: { nome: string } | null;
  material?: { nome: string } | null;
  localDescarga?: { nome: string } | null;
};

export function DetalheGrupoSheet({
  grupo,
  agruparPor,
  filtros,
  verComercial,
  onFechar,
}: {
  grupo: GrupoRelatorioViagens;
  agruparPor: AgruparPorRelatorio;
  filtros: Record<string, string>;
  verComercial: boolean;
  onFechar: () => void;
}) {
  // A listagem não sabe filtrar "onde a FK é nula", então o grupo "(sem
  // cliente)" não tem drill-down. Melhor dizer isso do que abrir uma lista
  // silenciosamente errada — que traria TODAS as viagens do período.
  const semDrill = grupo.chave === GRUPO_SEM_VALOR;

  const state = useDataTableState({
    defaultSort: { field: "data", order: "desc" },
    defaultPageSize: 50,
    syncUrl: false,
  });

  const params = React.useMemo(
    () => ({
      ...state,
      filters: {
        ...filtros,
        [PARAM_DA_DIMENSAO[agruparPor]]: grupo.chave,
        // Sem isto a lista abre com viagens que o resumo não contou (sem peso /
        // em andamento) e a contagem do cabeçalho não fecha com a da tabela.
        excluirForaFechamento: "true",
      },
    }),
    [state, filtros, agruparPor, grupo.chave],
  );

  const list = usePaginatedList<ViagemLinha>("/admin/viagens", params, {
    enabled: !semDrill,
  });

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="max-w-4xl">
        <SheetHeader>
          <SheetTitle>
            {grupo.nome}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {AGRUPAR_POR_LABEL[agruparPor]} · {grupo.viagens} viagens ·{" "}
              {fmtNum(Number(verComercial ? (grupo.toneladasEfetiva ?? 0) : grupo.toneladas), 3)} t
            </span>
          </SheetTitle>
        </SheetHeader>

        {semDrill ? (
          <p className="text-sm text-muted-foreground">
            Este grupo junta as viagens sem {AGRUPAR_POR_LABEL[agruparPor].toLowerCase()}{" "}
            preenchido. A lista de viagens não tem filtro para isso — abra a tela de Viagens e
            procure pelo período.
          </p>
        ) : list.isLoading ? (
          <LoadingInline />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-background">
                <tr className="text-left">
                  <th className="py-2 pr-2 font-medium">Data</th>
                  <th className="py-2 pr-2 font-medium">Placa</th>
                  <th className="py-2 pr-2 font-medium">Ticket</th>
                  <th className="py-2 pr-2 font-medium">Material</th>
                  <th className="py-2 pr-2 font-medium">Descarga</th>
                  <th className="py-2 pr-2 text-right font-medium">Ton.</th>
                  <th className="py-2 text-right font-medium">Km</th>
                </tr>
              </thead>
              <tbody>
                {(list.data?.data ?? []).map((v) => (
                  <tr key={v.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">
                      {/* viagem.data é @db.Date: fmtBR formata em UTC. Usar o
                          formatador de timestamp aqui voltaria um dia. */}
                      <Link href={`/viagens/${v.id}`} className="text-blue-600 hover:underline">
                        {fmtBR(v.data)}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2">{v.veiculo?.placa ?? "—"}</td>
                    <td className="py-1.5 pr-2">{v.ticket ?? "—"}</td>
                    <td className="py-1.5 pr-2">{v.material?.nome ?? "—"}</td>
                    <td className="py-1.5 pr-2">{v.localDescarga?.nome ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {fmtNum(verComercial ? (v.toneladasEfetiva ?? v.toneladas) : v.toneladas, 3)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fmtNum(verComercial ? (v.kmEfetivo ?? v.km) : v.km, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {list.data && list.data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                <span>
                  Página {list.data.pagination.page} de {list.data.pagination.totalPages} ·{" "}
                  {list.data.pagination.total} viagens
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border px-2 py-1 disabled:opacity-40"
                    disabled={state.page <= 1}
                    onClick={() => state.setPage(state.page - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="rounded border px-2 py-1 disabled:opacity-40"
                    disabled={state.page >= list.data.pagination.totalPages}
                    onClick={() => state.setPage(state.page + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
