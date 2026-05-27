"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AlertCircle, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { useDataTableState } from "@/hooks/use-data-table-state";
import {
  fetchApi,
  useAuthToken,
  usePaginatedList,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";
import type { LocalMapa } from "@/components/mapa-locais";

// Leaflet quebra em SSR (acessa window). Import dinâmico igual PontoMap.
const MapaLocais = dynamic(
  () => import("@/components/mapa-locais").then((m) => m.MapaLocais),
  {
    ssr: false,
    loading: () => (
      <div className="h-[calc(100vh-260px)] min-h-[500px] rounded-lg border bg-muted/30" />
    ),
  },
);

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";
type Cliente = { id: string; nome: string };
type Local = {
  id: string; nome: string; logradouro: string; numero: string | null; bairro: string | null;
  cidade: string; uf: string; cep: string | null; pontoReferencia: string | null;
  tipo: Tipo; ativo: boolean; clientes: Cliente[];
  criadoPor: { id: string; nome: string } | null;
  criadoPorMotorista: { id: string; nome: string } | null;
};

const PATH = "/admin/locais";
const CLIENTES_PATH = "/admin/clientes";

export default function LocaisPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Local>(PATH, tableState);
  const clientes = useResourceOptions<Cliente>(CLIENTES_PATH);
  const update = useUpdateResource<Record<string, unknown>, Local>(PATH, PATH);
  const token = useAuthToken();
  const [view, setView] = useState<"lista" | "mapa">("lista");

  // Carrega só quando aba "Mapa" tá ativa. Backend filtra por ativo + lat/lng.
  // QueryKey começa com PATH pra invalidate de create/update/delete pegar o mapa
  // junto (TanStack faz partial match por prefixo do array).
  const mapa = useQuery({
    queryKey: [PATH, "mapa", token],
    enabled: view === "mapa" && !!token,
    queryFn: () => fetchApi<LocalMapa[]>("/admin/locais/mapa", { token }),
    staleTime: 60_000,
  });

  const totalGeral = list.data?.pagination.total ?? 0;
  const totalNoMapa = mapa.data?.length ?? 0;
  const semCoord = view === "mapa" && mapa.data ? Math.max(totalGeral - totalNoMapa, 0) : 0;

  const clienteOptions = useMemo(
    () => (clientes.data ?? []).map((o) => ({ value: o.id, label: o.nome })),
    [clientes.data],
  );

  const columns = useMemo<ColumnDef<Local>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "endereco",
        enableSorting: false,
        header: "Endereço",
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.logradouro}
            {row.original.numero ? `, ${row.original.numero}` : ""}
            {row.original.bairro ? ` — ${row.original.bairro}` : ""}
          </span>
        ),
      },
      {
        id: "cidade",
        accessorKey: "cidade",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cidade/UF" />,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.cidade}/{row.original.uf}
          </span>
        ),
      },
      {
        id: "cliente",
        enableSorting: false,
        header: "Cliente",
        cell: ({ row }) => {
          const cs = row.original.clientes;
          const primeiro = cs[0];
          if (!primeiro) return "—";
          if (cs.length === 1) return primeiro.nome;
          return (
            <span title={cs.map((c) => c.nome).join(", ")}>
              {primeiro.nome}{" "}
              <span className="text-muted-foreground">+{cs.length - 1}</span>
            </span>
          );
        },
      },
      {
        id: "tipo",
        accessorKey: "tipo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
      },
      {
        id: "criadoPor",
        enableSorting: false,
        header: "Criado por",
        cell: ({ row }) => {
          const nome =
            row.original.criadoPor?.nome ??
            row.original.criadoPorMotorista?.nome ??
            "—";
          return <span className="text-sm text-muted-foreground">{nome}</span>;
        },
      },
      {
        id: "acoes",
        size: 180,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-2">
            <StatusToggle
              active={row.original.ativo}
              onChange={(next) =>
                update.mutate({ id: row.original.id, body: { ativo: next } })
              }
              size="sm"
            />
            <Link href={`/locais/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <ExcluirButton
              path="/admin/locais"
              id={row.original.id}
              nomeRecurso={`o local "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Locais</h1>
          <p className="text-sm text-muted-foreground">
            Locais de carga e descarga. Busque por nome, endereço ou ponto de interesse.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/locais/em-validacao">
            <Button variant="outline" className="w-full md:w-auto">
              <AlertCircle className="h-4 w-4" /> Em validação
            </Button>
          </Link>
          <Link href="/locais/novo">
            <Button className="w-full md:w-auto">
              <Plus className="h-4 w-4" /> Novo local
            </Button>
          </Link>
        </div>
      </header>

      <div className="flex gap-1 border-b">
        {(["lista", "mapa"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`border-b-2 px-4 py-2 text-sm transition-colors ${
              view === v
                ? "border-blue-600 font-medium text-blue-700"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {v === "lista" ? "Lista" : "Mapa"}
          </button>
        ))}
      </div>

      {view === "mapa" && semCoord > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {semCoord} local{semCoord === 1 ? "" : "is"} sem coordenada não
            aparece{semCoord === 1 ? "" : "m"} no mapa. Edite pra preencher
            endereço completo.
          </span>
        </div>
      )}

      {view === "mapa" ? (
        <MapaLocais locais={mapa.data ?? []} loading={mapa.isLoading} />
      ) : (
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
            searchPlaceholder="Buscar por nome, endereço, bairro, cidade…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.tipo}
                  onChange={(v) => tableState.setFilter("tipo", v)}
                  placeholder="Tipo"
                  showSearch={false}
                  options={[
                    { value: "AMBOS", label: "Ambos" },
                    { value: "CARGA", label: "Carga" },
                    { value: "DESCARGA", label: "Descarga" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.clienteId}
                  onChange={(v) => tableState.setFilter("clienteId", v)}
                  placeholder="Cliente"
                  options={clienteOptions}
                />
                <Combobox
                  value={tableState.filters.ativo}
                  onChange={(v) => tableState.setFilter("ativo", v)}
                  placeholder="Status"
                  showSearch={false}
                  options={[
                    { value: "true", label: "Ativos" },
                    { value: "false", label: "Inativos" },
                  ]}
                />
              </>
            }
          />
        }
        emptyMessage="Nenhum local cadastrado."
        renderMobileCard={(l) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.nome}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {l.cidade}/{l.uf}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={l.ativo}
                  onChange={(next) => update.mutate({ id: l.id, body: { ativo: next } })}
                  size="sm"
                  label
                />
                <Link href={`/locais/${l.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <ExcluirButton
                  path="/admin/locais"
                  id={l.id}
                  nomeRecurso={`o local "${l.nome}"`}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {l.logradouro}
              {l.numero ? `, ${l.numero}` : ""}
              {l.bairro ? ` — ${l.bairro}` : ""}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>
                <span className="text-muted-foreground">Tipo: </span>
                {l.tipo}
              </span>
              {l.clientes[0] && (
                <span title={l.clientes.map((c) => c.nome).join(", ")}>
                  <span className="text-muted-foreground">Cliente: </span>
                  {l.clientes[0].nome}
                  {l.clientes.length > 1 && (
                    <span className="text-muted-foreground"> +{l.clientes.length - 1}</span>
                  )}
                </span>
              )}
            </div>
          </Card>
        )}
      />
      )}
    </div>
  );
}
