"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Camera,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterDateRange,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { ListMetric } from "@/components/list-metric";
import { firstDayOfMonth, useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList, useResourceOptions } from "@/lib/client-api";
import { fmtBR, fmtNum } from "@/lib/fechamento-helpers";
import { ValorComMinimo } from "@/components/valor-com-minimo";

type Viagem = {
  id: string;
  data: string;
  toneladas: string;
  ticket: string | null;
  km: string;
  status: string;
  /** true = veio do fluxo guiado "Iniciar viagem" (lifecycle). */
  iniciadaGuiada: boolean;
  toneladasInformada: string;
  toneladasEfetiva: string;
  toneladasAjustada: boolean;
  kmInformado: string;
  kmEfetivo: string;
  kmAjustada: boolean;
  ocrCampos: string[];
  veiculo: { id: string; placa: string };
  motorista: { id: string; nome: string };
  cliente: { id: string; nome: string };
  material: { id: string; nome: string; exigeTicket: boolean };
  localCarga: { id: string; nome: string; cidade: string; uf: string };
  localDescarga: { id: string; nome: string; cidade: string; uf: string };
  fotos: { id: string; storageKey: string }[];
  /** true quando rota passa por pedágio cadastrado mas motorista não pôs valor. */
  temPedagioSemValor: boolean;
};

type Motorista = { id: string; nome: string };
type Cliente = { id: string; nome: string };

const STATUS_VIAGEM_LABEL: Record<string, string> = {
  ENVIADA: "Aguardando",
  EM_CONFERENCIA: "Em conferência",
  OK: "OK",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
  RASCUNHO_OFFLINE: "Rascunho",
  AGUARDANDO_PESO: "Aguardando peso",
};

const STATUS_VIAGEM_COLOR: Record<string, string> = {
  ENVIADA: "bg-amber-100 text-amber-900 border-amber-200",
  EM_CONFERENCIA: "bg-purple-100 text-purple-800 border-purple-200",
  OK: "bg-green-100 text-green-800 border-green-200",
  DIVERGENTE: "bg-red-100 text-red-800 border-red-200",
  AJUSTADA: "bg-blue-100 text-blue-800 border-blue-200",
  RASCUNHO_OFFLINE: "bg-gray-100 text-gray-700 border-gray-200",
  AGUARDANDO_PESO: "bg-orange-100 text-orange-900 border-orange-300",
};

export default function ViagensPage() {
  const tableState = useDataTableState({
    defaultSort: { field: "data", order: "desc" },
    defaultFilters: { de: firstDayOfMonth() },
  });
  const list = usePaginatedList<Viagem>("/admin/viagens", tableState);
  const motoristas = useResourceOptions<Motorista>("/admin/motoristas");
  const clientes = useResourceOptions<Cliente>("/admin/clientes");
  const { viewMode, setViewMode } = useListViewMode("viagens");

  const motoristaOptions = useMemo(
    () => (motoristas.data ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [motoristas.data],
  );
  const clienteOptions = useMemo(
    () => (clientes.data ?? []).map((c) => ({ value: c.id, label: c.nome })),
    [clientes.data],
  );

  const columns = useMemo<ColumnDef<Viagem>[]>(
    () => [
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1">
            <Badge className={STATUS_VIAGEM_COLOR[row.original.status] ?? ""}>
              {STATUS_VIAGEM_LABEL[row.original.status] ?? row.original.status}
            </Badge>
            {row.original.iniciadaGuiada && (
              <Badge
                className="border-indigo-200 bg-indigo-100 text-indigo-800"
                title="Lançada pelo fluxo guiado 'Iniciar viagem'"
              >
                Guiada
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "alertas",
        enableSorting: false,
        header: () => <span>Alertas</span>,
        cell: ({ row }) =>
          row.original.temPedagioSemValor ? (
            <Badge
              className="border-orange-200 bg-orange-100 text-orange-900"
              title="Rota passa por pedágio cadastrado mas valor não foi preenchido"
            >
              Pedágio?
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "data",
        accessorKey: "data",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Data" />,
        cell: ({ row }) => <span className="text-sm">{fmtBR(row.original.data)}</span>,
      },
      {
        id: "placa",
        accessorKey: "veiculo.placa",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Placa" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.veiculo.placa}</span>
        ),
      },
      {
        id: "motorista",
        accessorKey: "motorista.nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Motorista" />,
        cell: ({ row }) => <span className="text-sm">{row.original.motorista.nome}</span>,
      },
      {
        id: "cliente",
        accessorKey: "cliente.nome",
        enableSorting: false,
        header: "Material / Cliente",
        cell: ({ row }) => (
          <div className="text-sm">
            <div className="font-medium">{row.original.material.nome}</div>
            <div className="text-xs text-muted-foreground">{row.original.cliente.nome}</div>
          </div>
        ),
      },
      {
        id: "trajeto",
        enableSorting: false,
        header: "Trajeto",
        cell: ({ row }) => (
          <div className="text-xs">
            <div className="flex items-center gap-1">
              <ArrowUp className="h-3 w-3 text-muted-foreground" />
              {row.original.localCarga.nome.length > 28
                ? row.original.localCarga.nome.slice(0, 25) + "..."
                : row.original.localCarga.nome}
            </div>
            <div className="flex items-center gap-1">
              <ArrowDown className="h-3 w-3 text-muted-foreground" />
              {row.original.localDescarga.nome.length > 28
                ? row.original.localDescarga.nome.slice(0, 25) + "..."
                : row.original.localDescarga.nome}
            </div>
          </div>
        ),
      },
      {
        id: "toneladas",
        accessorKey: "toneladas",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Toneladas" />,
        cell: ({ row }) => (
          <ValorComMinimo
            className="text-sm"
            efetivo={row.original.toneladasEfetiva}
            real={row.original.toneladasInformada}
            ajustada={row.original.toneladasAjustada}
            unidade="t"
            casas={3}
          />
        ),
      },
      {
        id: "ticket",
        accessorKey: "ticket",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ticket" />,
        cell: ({ row }) =>
          row.original.ticket ? (
            <span className="font-mono text-sm">
              {row.original.ticket}
              {row.original.ocrCampos && row.original.ocrCampos.length > 0 && (
                <span
                  className="ml-1 text-xs text-indigo-600"
                  title={`Campos pela IA: ${row.original.ocrCampos.join(", ")}`}
                >
                  ✨
                </span>
              )}
            </span>
          ) : row.original.material.exigeTicket ? (
            <span className="text-xs italic text-muted-foreground">sem ticket</span>
          ) : (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
              title={`${row.original.material.nome} não exige ticket`}
            >
              não exige
            </span>
          ),
      },
      {
        id: "km",
        accessorKey: "km",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Km" />,
        cell: ({ row }) => (
          <ValorComMinimo
            className="text-sm"
            efetivo={row.original.kmEfetivo}
            real={row.original.kmInformado}
            ajustada={row.original.kmAjustada}
            unidade="km"
            casas={2}
          />
        ),
      },
      {
        id: "acoes",
        size: 90,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-1">
            {row.original.fotos.length > 0 && (
              <Camera className="h-4 w-4 text-muted-foreground" />
            )}
            <Link href={`/viagens/${row.original.id}`}>
              <span className="rounded p-1 hover:bg-muted">
                <ExternalLink className="h-4 w-4" />
              </span>
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
          <h1 className="text-2xl font-semibold tracking-tight">Viagens</h1>
          <p className="text-sm text-muted-foreground">
            Lançamentos dos motoristas, com status visual de conferência.
          </p>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </header>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        pagination={list.data?.pagination}
        state={tableState}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        toolbar={
          <DataTableToolbar
            state={tableState}
            searchPlaceholder="Buscar por ticket, motorista, placa, cliente…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.status}
                  onChange={(v) => tableState.setFilter("status", v)}
                  placeholder="Status"
                  showSearch={false}
                  options={[
                    { value: "ENVIADA", label: "Aguardando" },
                    { value: "EM_CONFERENCIA", label: "Em conferência" },
                    { value: "OK", label: "OK" },
                    { value: "DIVERGENTE", label: "Divergente" },
                    { value: "AJUSTADA", label: "Ajustada" },
                    { value: "AGUARDANDO_PESO", label: "Aguardando peso" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.origem}
                  onChange={(v) => tableState.setFilter("origem", v)}
                  placeholder="Origem"
                  showSearch={false}
                  options={[
                    { value: "guiada", label: "Guiada" },
                    { value: "direta", label: "Direta" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.motoristaId}
                  onChange={(v) => tableState.setFilter("motoristaId", v)}
                  placeholder="Motorista"
                  options={motoristaOptions}
                />
                <Combobox
                  value={tableState.filters.clienteId}
                  onChange={(v) => tableState.setFilter("clienteId", v)}
                  placeholder="Cliente"
                  options={clienteOptions}
                />
                <ToolbarFilterDateRange state={tableState} label="Período" />
              </>
            }
          />
        }
        emptyMessage="Nenhuma viagem nesse filtro."
        viewMode={viewMode}
        renderMobileCard={(v) => <ViagemCard v={v} />}
      />
    </div>
  );
}

/**
 * Card horizontal moderno pra cada viagem. Layout adapta:
 * - Mobile/notebook estreito: tudo empilhado
 * - Notebook/desktop: grid horizontal com colunas (status, info, trajeto, métricas)
 *
 * Estética: borda sutil, hover com sombra leve, hierarquia clara (status colorido
 * no canto, motorista e ticket em destaque, cliente em cinza, métricas alinhadas).
 */
function ViagemCard({ v }: { v: Viagem }) {
  return (
    <Link href={`/viagens/${v.id}`} className="block group">
      <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
          {/* Coluna 1: status + alertas (compacta, sempre alinhada à esquerda) */}
          <div className="flex flex-row items-center gap-2 sm:flex-col sm:items-start">
            <Badge className={STATUS_VIAGEM_COLOR[v.status] ?? ""}>
              {STATUS_VIAGEM_LABEL[v.status] ?? v.status}
            </Badge>
            {v.iniciadaGuiada && (
              <Badge
                className="border-indigo-200 bg-indigo-100 text-indigo-800"
                title="Lançada pelo fluxo guiado 'Iniciar viagem'"
              >
                Guiada
              </Badge>
            )}
            {v.temPedagioSemValor && (
              <Badge
                className="gap-1 border-orange-200 bg-orange-100 text-orange-900"
                title="Rota passa por pedágio cadastrado mas valor não foi preenchido"
              >
                <AlertTriangle className="h-3 w-3" /> Pedágio?
              </Badge>
            )}
          </div>

          {/* Coluna 2 (principal): trajeto + cliente + motorista */}
          <div className="min-w-0 space-y-2">
            {/* Trajeto inline com seta */}
            <div className="flex items-center gap-2 text-sm">
              <ArrowUp className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="truncate font-medium">{v.localCarga.nome}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <ArrowDown className="h-3.5 w-3.5 shrink-0 text-rose-600" />
              <span className="truncate font-medium">{v.localDescarga.nome}</span>
            </div>
            {/* Detalhes secundários separados por bullet */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{fmtBR(v.data)}</span>
              <span>·</span>
              <span>{v.motorista.nome}</span>
              <span>·</span>
              <span className="font-mono">{v.veiculo.placa}</span>
              <span>·</span>
              <span>{v.material.nome}</span>
              <span>·</span>
              <span className="text-foreground/70">{v.cliente.nome}</span>
            </div>
          </div>

          {/* Coluna 3: métricas alinhadas em larguras fixas + slot reservado
              pra ícone foto (invisível quando 0). Garante alinhamento vertical
              perfeito entre cards independente de haver foto ou não. */}
          <div className="flex items-center gap-4">
            <div className="flex gap-4">
              <ListMetric
                label="Toneladas"
                width={100}
                value={
                  <ValorComMinimo
                    className="text-sm font-semibold tabular-nums"
                    efetivo={v.toneladasEfetiva}
                    real={v.toneladasInformada}
                    ajustada={v.toneladasAjustada}
                    unidade="t"
                    casas={3}
                  />
                }
              />
              <ListMetric
                label="Km"
                width={90}
                value={
                  <ValorComMinimo
                    className="text-sm font-semibold tabular-nums"
                    efetivo={v.kmEfetivo}
                    real={v.kmInformado}
                    ajustada={v.kmAjustada}
                    unidade="km"
                    casas={2}
                  />
                }
              />
              <ListMetric
                label="Ticket"
                width={90}
                value={
                  <span className="font-mono text-sm font-semibold">
                    {v.ticket}
                    {v.ocrCampos && v.ocrCampos.length > 0 && (
                      <span
                        className="ml-1 text-xs text-indigo-600"
                        title={`Campos pela IA: ${v.ocrCampos.join(", ")}`}
                      >
                        ✨
                      </span>
                    )}
                  </span>
                }
              />
            </div>
            {/* Slot fixo: icone foto (com contador) + chevron. Width fixa
                garante alinhamento mesmo quando viagem nao tem foto. */}
            <div className="flex w-12 shrink-0 items-center justify-end gap-1.5 text-muted-foreground">
              <span
                className={`flex items-center gap-0.5 text-xs ${v.fotos.length > 0 ? "" : "invisible"}`}
                title={`${v.fotos.length} foto${v.fotos.length === 1 ? "" : "s"}`}
              >
                <Camera className="h-3.5 w-3.5" /> {v.fotos.length || ""}
              </span>
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

