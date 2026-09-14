"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ClipboardList, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { UNIDADE_PEDIDO_LABEL, type UnidadePedidoTipo } from "@ronan/shared-types";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, DataTableToolbar } from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList, useResourceOptions, useUpdateResource } from "@/lib/client-api";

type Saldo = {
  alvo: string;
  entregue: string;
  restante: string;
  percentual: number;
  viagens: number;
  diasRestantes: number | null;
  ritmoNecessario: string | null;
  situacao: "CUMPRIDO" | "NO_RITMO" | "APERTADO" | "ESTOURADO" | "SEM_PRAZO";
};

type Pedido = {
  id: string;
  numero: number;
  empresa: { id: string; nome: string };
  cliente: { id: string; nome: string } | null;
  material: { id: string; nome: string } | null;
  localDescarga: { id: string; nome: string; cidade: string | null } | null;
  quantidadeAlvo: string;
  unidadeAlvo: UnidadePedidoTipo;
  prazoEm: string | null;
  prioridade: number;
  status: "ABERTO" | "EM_CURSO" | "CUMPRIDO" | "CANCELADO";
  saldo: Saldo | null;
};

const PATH = "/admin/pedidos";

const SITUACAO: Record<Saldo["situacao"], { label: string; cls: string; barra: string }> = {
  CUMPRIDO: { label: "Cumprido", cls: "bg-emerald-100 text-emerald-700", barra: "bg-emerald-500" },
  NO_RITMO: { label: "No ritmo", cls: "bg-blue-100 text-blue-700", barra: "bg-blue-500" },
  APERTADO: { label: "Ritmo apertado", cls: "bg-amber-100 text-amber-800", barra: "bg-amber-500" },
  ESTOURADO: { label: "Passou do prazo", cls: "bg-red-100 text-red-700", barra: "bg-red-500" },
  SEM_PRAZO: { label: "Sem prazo", cls: "bg-slate-100 text-slate-700", barra: "bg-slate-400" },
};

function dataBR(v: string | null): string {
  if (!v) return "—";
  const [a, m, d] = v.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Barra de progresso com o número por cima — é a informação, não enfeite. */
function Progresso({ saldo, unidade }: { saldo: Saldo | null; unidade: UnidadePedidoTipo }) {
  if (!saldo) return <span className="text-muted-foreground">—</span>;
  const s = SITUACAO[saldo.situacao];
  return (
    <div className="min-w-[160px] space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
        <span className="font-medium">
          {saldo.entregue} / {saldo.alvo}
        </span>
        <span className="text-xs text-muted-foreground">{UNIDADE_PEDIDO_LABEL[unidade]}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${s.barra}`} style={{ width: `${saldo.percentual}%` }} />
      </div>
      {/* O que o supervisor precisa decidir agora: dá pro prazo? */}
      {saldo.ritmoNecessario && saldo.diasRestantes != null && (
        <p className="text-xs text-muted-foreground tabular-nums">
          faltam {saldo.restante} em {saldo.diasRestantes}{" "}
          {saldo.diasRestantes === 1 ? "dia" : "dias"} · {saldo.ritmoNecessario}/dia
        </p>
      )}
    </div>
  );
}

export default function PedidosPage() {
  return (
    <RequerTela chave="pedidos.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const tableState = useDataTableState({
    defaultSort: { field: "prioridade", order: "desc" },
    defaultFilters: { abertos: "true" },
  });
  const list = usePaginatedList<Pedido>(PATH, tableState);
  const empresas = useResourceOptions<{ id: string; nome: string }>("/admin/empresas");
  const update = useUpdateResource<{ status?: string }, Pedido>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("pedidos");

  const empresaOptions = useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const columns = useMemo<ColumnDef<Pedido>[]>(
    () => [
      {
        id: "numero",
        size: 64,
        header: "Nº",
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">#{row.original.numero}</span>
        ),
      },
      {
        id: "empresa",
        enableSorting: false,
        header: "Cliente",
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.empresa.nome}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[row.original.cliente?.nome, row.original.material?.nome]
                .filter(Boolean)
                .join(" · ") || "qualquer obra e material"}
            </p>
          </div>
        ),
      },
      {
        id: "destino",
        enableSorting: false,
        header: "Destino",
        cell: ({ row }) =>
          row.original.localDescarga ? (
            <span className="text-sm">
              {row.original.localDescarga.nome}
              {row.original.localDescarga.cidade && (
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {row.original.localDescarga.cidade}
                </span>
              )}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          ),
      },
      {
        id: "progresso",
        enableSorting: false,
        header: "Entregue",
        cell: ({ row }) => (
          <Progresso saldo={row.original.saldo} unidade={row.original.unidadeAlvo} />
        ),
      },
      {
        id: "prazoEm",
        header: "Prazo",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm tabular-nums">
            {dataBR(row.original.prazoEm)}
          </span>
        ),
      },
      {
        id: "situacao",
        enableSorting: false,
        header: "Situação",
        cell: ({ row }) => {
          const s = row.original.saldo;
          if (!s) return null;
          return (
            <Badge className={`border-transparent ${SITUACAO[s.situacao].cls}`}>
              {SITUACAO[s.situacao].label}
            </Badge>
          );
        },
      },
      {
        id: "acoes",
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Permitido chave="pedidos.editar">
              <Link href={`/pedidos/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Abrir">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            {/* Pedido com programação NÃO é apagado: o backend só marca
                CANCELADO (pedidos.service.ts). O diálogo dizia "não pode ser
                desfeita" pros dois casos — e o toast saía "Este pedido
                excluído com sucesso" pra um pedido que continuava lá. */}
            <ExcluirButton
              perm="pedidos.excluir"
              path={PATH}
              id={row.original.id}
              nomeRecurso="este pedido"
              descricaoConfirmacao="Se o pedido já tem viagens programadas, ele é cancelado e as viagens continuam no quadro do dia. Se não tem nenhuma, some de vez."
            />
          </div>
        ),
      },
    ],
    [update],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos do cliente</h1>
          <p className="text-sm text-muted-foreground">
            O que foi combinado entregar, e quanto já foi. O saldo sai das viagens de verdade —
            não é contador.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="pedidos.criar">
            <Link href="/pedidos/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo pedido
              </Button>
            </Link>
          </Permitido>
        </div>
      </header>

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
            searchPlaceholder="Buscar por cliente, obra ou material…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.empresaId}
                  onChange={(v) => tableState.setFilter("empresaId", v)}
                  placeholder="Empresa"
                  options={empresaOptions}
                />
                <Combobox
                  value={tableState.filters.abertos}
                  onChange={(v) => tableState.setFilter("abertos", v)}
                  placeholder="Todos"
                  options={[{ value: "true", label: "Só em aberto" }]}
                />
              </>
            }
          />
        }
        emptyMessage="Nenhum pedido. Cadastre o que o cliente combinou pra acompanhar o saldo."
        viewMode={viewMode}
        renderMobileCard={(p) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 font-medium">
                  <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {p.empresa.nome}
                </p>
                <p className="text-xs text-muted-foreground">
                  #{p.numero} · {[p.cliente?.nome, p.material?.nome].filter(Boolean).join(" · ")}
                </p>
              </div>
              {p.saldo && (
                <Badge className={`border-transparent ${SITUACAO[p.saldo.situacao].cls}`}>
                  {SITUACAO[p.saldo.situacao].label}
                </Badge>
              )}
            </div>
            <Progresso saldo={p.saldo} unidade={p.unidadeAlvo} />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground tabular-nums">
                prazo {dataBR(p.prazoEm)}
              </span>
              <Permitido chave="pedidos.editar">
                <Link href={`/pedidos/${p.id}`}>
                  <Button variant="outline" size="sm">
                    Abrir
                  </Button>
                </Link>
              </Permitido>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
