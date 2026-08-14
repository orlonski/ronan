"use client";

import * as React from "react";
import Link from "next/link";
import {
  AGRUPAR_POR_ABASTECIMENTO_LABEL,
  type AgruparPorAbastecimento,
  GRUPO_SEM_VALOR,
  type GrupoRelatorioAbastecimentos,
  TIPO_COMBUSTIVEL_LABEL,
} from "@ronan/shared-types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LoadingInline } from "@/components/loading";
import { usePaginatedList } from "@/lib/client-api";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { fmtBRL, fmtDataHoraBR, fmtNum } from "@/lib/fechamento-helpers";

/**
 * Drill-down de uma linha do relatório: os abastecimentos que formaram aquele
 * número. Reusa `GET /admin/abastecimentos` em vez de um endpoint próprio —
 * aquele já pagina e aplica o escopo. O relatório só acrescentou lá os filtros
 * que faltavam (frota e posto).
 */

/** Query param da listagem que corresponde a cada dimensão. */
const PARAM_DA_DIMENSAO: Record<AgruparPorAbastecimento, string> = {
  MOTORISTA: "motoristaId",
  VEICULO: "veiculoId",
  EMPRESA: "empresaId",
  TRANSPORTADORA: "transportadoraId",
  POSTO: "posto",
  TIPO: "tipo",
};

/**
 * Como filtrar o grupo "(sem …)". Só existe pras dimensões em que a listagem
 * sabe procurar por ausência — sem isso o drill-down abriria a lista INTEIRA do
 * período fingindo ser o grupo.
 */
const PARAM_SEM_VALOR: Partial<Record<AgruparPorAbastecimento, string>> = {
  EMPRESA: "semEmpresa",
  POSTO: "semPosto",
};

type AbastecimentoLinha = {
  id: string;
  data: string;
  tipo: keyof typeof TIPO_COMBUSTIVEL_LABEL;
  litros: string;
  valorTotal: string | null;
  precoLitro: string | null;
  emComboio: boolean;
  odometro: number;
  postoNome: string | null;
  motorista?: { nome: string };
  veiculo?: { placa: string };
  empresa?: { nome: string } | null;
};

export function DetalheGrupoAbastecimentoSheet({
  grupo,
  agruparPor,
  filtros,
  onFechar,
}: {
  grupo: GrupoRelatorioAbastecimentos;
  agruparPor: AgruparPorAbastecimento;
  filtros: Record<string, string>;
  onFechar: () => void;
}) {
  const semValor = grupo.chave === GRUPO_SEM_VALOR;
  const paramSemValor = PARAM_SEM_VALOR[agruparPor];
  const semDrill = semValor && !paramSemValor;

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
        ...(semValor
          ? { [paramSemValor!]: "true" }
          : // Posto vai pelo NOME exibido, não pela chave (que é caixa alta pra
            // não rachar o grupo). A listagem compara sem diferenciar caixa.
            { [PARAM_DA_DIMENSAO[agruparPor]]: agruparPor === "POSTO" ? grupo.nome : grupo.chave }),
      },
    }),
    [state, filtros, agruparPor, grupo.chave, grupo.nome, semValor, paramSemValor],
  );

  const list = usePaginatedList<AbastecimentoLinha>("/admin/abastecimentos", params, {
    enabled: !semDrill,
  });

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent className="max-w-4xl">
        <SheetHeader>
          <SheetTitle>
            {grupo.nome}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {AGRUPAR_POR_ABASTECIMENTO_LABEL[agruparPor]} · {grupo.abastecimentos} abastecimentos ·{" "}
              {fmtNum(Number(grupo.litros), 3)} L · {fmtBRL(Number(grupo.valor))}
            </span>
          </SheetTitle>
        </SheetHeader>

        {semDrill ? (
          <p className="text-sm text-muted-foreground">
            Este grupo junta os abastecimentos sem{" "}
            {AGRUPAR_POR_ABASTECIMENTO_LABEL[agruparPor].toLowerCase()} preenchido. A lista de
            abastecimentos não tem filtro para isso — abra a tela de Abastecimentos e procure pelo
            período.
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
                  <th className="py-2 pr-2 font-medium">Posto</th>
                  <th className="py-2 pr-2 font-medium">Combustível</th>
                  <th className="py-2 pr-2 text-right font-medium">Litros</th>
                  <th className="py-2 pr-2 text-right font-medium">Valor</th>
                  <th className="py-2 text-right font-medium">R$/L</th>
                </tr>
              </thead>
              <tbody>
                {(list.data?.data ?? []).map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">
                      <Link
                        href={`/abastecimentos/${a.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {fmtDataHoraBR(a.data)}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2">{a.veiculo?.placa ?? "—"}</td>
                    <td className="py-1.5 pr-2">{a.postoNome ?? "—"}</td>
                    <td className="py-1.5 pr-2">{TIPO_COMBUSTIVEL_LABEL[a.tipo] ?? a.tipo}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {fmtNum(a.litros, 3)}
                    </td>
                    {/* Comboio sem valor mostra o motivo, não R$ 0,00. */}
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {a.valorTotal ? (
                        fmtBRL(a.valorTotal)
                      ) : (
                        <span className="text-xs text-amber-600">
                          {a.emComboio ? "comboio" : "sem valor"}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {a.precoLitro ? fmtNum(a.precoLitro, 3) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {list.data && list.data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                <span>
                  Página {list.data.pagination.page} de {list.data.pagination.totalPages} ·{" "}
                  {list.data.pagination.total} abastecimentos
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
