"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, HandCoins, Play } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DataTable, DataTableToolbar } from "@/components/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { fetchApi, usePaginatedList, useAuthToken } from "@/lib/client-api";
import { primeiroDiaDoMesSP, ultimoDiaDoMesSP } from "@/lib/datetime-br";

type Acerto = {
  id: string;
  motorista: { id: string; nome: string };
  periodoInicio: string;
  periodoFim: string;
  valorCreditos: string;
  valorDebitos: string;
  valorLiquido: string;
  status: "ABERTO" | "FECHADO" | "PAGO";
  vistoEm: string | null;
  pagoEm: string | null;
  _count: { itens: number };
};

const PATH = "/admin/acertos";

function brl(v: string): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : v;
}

function data(v: string): string {
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}`;
}

const STATUS_BADGE: Record<Acerto["status"], { label: string; cls: string }> = {
  ABERTO: { label: "Aberto", cls: "border-transparent bg-amber-100 text-amber-800" },
  FECHADO: { label: "Fechado", cls: "border-transparent bg-blue-100 text-blue-700" },
  PAGO: { label: "Pago", cls: "border-transparent bg-emerald-100 text-emerald-700" },
};

export default function AcertosPage() {
  return (
    <RequerTela chave="acertos.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const tableState = useDataTableState({
    defaultSort: { field: "periodoInicio", order: "desc" },
  });
  const list = usePaginatedList<Acerto>(PATH, tableState);
  const { viewMode, setViewMode } = useListViewMode("acertos");

  const [periodo, setPeriodo] = useState({
    inicio: primeiroDiaDoMesSP(),
    fim: ultimoDiaDoMesSP(),
  });
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  async function gerarLote() {
    if (!token) return;
    setGerando(true);
    setResultado(null);
    try {
      const r = await fetchApi<{ total: number; gerados: number }>(
        `${PATH}/gerar-lote`,
        {
          token,
          method: "POST",
          body: JSON.stringify({ periodoInicio: periodo.inicio, periodoFim: periodo.fim }),
        },
      );
      setResultado(
        `${r.gerados} de ${r.total} acertos gerados.` +
          (r.gerados < r.total
            ? " Os que faltaram já estavam fechados — reabra se quiser gerar de novo."
            : ""),
      );
      await queryClient.invalidateQueries({ queryKey: [PATH] });
    } catch (e) {
      setResultado((e as Error).message);
    } finally {
      setGerando(false);
    }
  }

  const columns = useMemo<ColumnDef<Acerto>[]>(
    () => [
      {
        id: "motorista",
        enableSorting: false,
        header: "Motorista",
        cell: ({ row }) => <span className="font-medium">{row.original.motorista.nome}</span>,
      },
      {
        id: "periodoInicio",
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Período" />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-sm">
            {data(row.original.periodoInicio)} a {data(row.original.periodoFim)}
          </span>
        ),
      },
      {
        id: "creditos",
        enableSorting: false,
        header: "Ganhos",
        cell: ({ row }) => (
          <span className="tabular-nums text-emerald-700">{brl(row.original.valorCreditos)}</span>
        ),
      },
      {
        id: "debitos",
        enableSorting: false,
        header: "Descontos",
        cell: ({ row }) =>
          Number(row.original.valorDebitos) > 0 ? (
            <span className="tabular-nums text-red-700">− {brl(row.original.valorDebitos)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "valorLiquido",
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="A receber" />
        ),
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums">{brl(row.original.valorLiquido)}</span>
        ),
      },
      {
        id: "status",
        enableSorting: true,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Status" />
        ),
        cell: ({ row }) => {
          const s = STATUS_BADGE[row.original.status];
          return (
            <div className="flex flex-col gap-0.5">
              <Badge className={s.cls}>{s.label}</Badge>
              {/* Se ele nunca abriu o extrato, ninguém pode dizer que concordou. */}
              {row.original.status !== "ABERTO" && !row.original.vistoEm && (
                <span className="text-[10px] text-muted-foreground">motorista não viu</span>
              )}
            </div>
          );
        },
      },
      {
        id: "acoes",
        size: 70,
        enableSorting: false,
        header: () => <span className="block text-center">Ver</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Link href={`/acertos/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Abrir acerto">
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Acertos com motorista</h1>
          <p className="text-sm text-muted-foreground">
            O que a empresa deve a cada motorista no período: o que ele ganhou, o que adiantou
            do bolso e o que foi descontado.
          </p>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </header>

      <Permitido chave="acertos.gerar">
        <Card className="space-y-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="acerto-inicio">Do dia</Label>
              <Input
                id="acerto-inicio"
                type="date"
                value={periodo.inicio}
                onChange={(e) => setPeriodo({ ...periodo, inicio: e.target.value })}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acerto-fim">Até</Label>
              <Input
                id="acerto-fim"
                type="date"
                value={periodo.fim}
                onChange={(e) => setPeriodo({ ...periodo, fim: e.target.value })}
                className="w-40"
              />
            </div>
            <Button onClick={gerarLote} disabled={gerando}>
              <Play className="h-4 w-4" />
              {gerando ? "Gerando…" : "Gerar acertos do período"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Gera pra todos os motoristas ativos de uma vez. Rodar de novo é seguro: só o que
            a regra calcula é refeito — adiantamento e desconto lançados à mão continuam lá.
          </p>
          {resultado && <p className="text-sm">{resultado}</p>}
        </Card>
      </Permitido>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        pagination={list.data?.pagination}
        state={tableState}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        toolbar={
          <DataTableToolbar
            state={tableState}
            searchPlaceholder="Buscar por motorista…"
            filters={
              <Combobox
                value={tableState.filters.status}
                onChange={(v) => tableState.setFilter("status", v)}
                placeholder="Status"
                options={[
                  { value: "ABERTO", label: "Aberto" },
                  { value: "FECHADO", label: "Fechado" },
                  { value: "PAGO", label: "Pago" },
                ]}
              />
            }
          />
        }
        emptyMessage="Nenhum acerto ainda. Escolha o período acima e gere."
        viewMode={viewMode}
        renderMobileCard={(a) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.motorista.nome}</span>
              <Badge className={STATUS_BADGE[a.status].cls}>{STATUS_BADGE[a.status].label}</Badge>
            </div>
            <div className="text-sm tabular-nums text-muted-foreground">
              {data(a.periodoInicio)} a {data(a.periodoFim)} · {a._count.itens} lançamento(s)
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
                <HandCoins className="h-4 w-4 text-muted-foreground" />
                {brl(a.valorLiquido)}
              </span>
              <Link href={`/acertos/${a.id}`}>
                <Button variant="outline" size="sm">
                  Abrir
                </Button>
              </Link>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
