"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  Eye,
  MapPin,
  Pencil,
  Plus,
  Truck,
  User,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useListViewMode } from "@/hooks/use-list-view-mode";
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
type Origem =
  | "MOTORISTA_FORMULARIO"
  | "MOTORISTA_RAPIDO"
  | "VIAGEM_OFFLINE"
  | "ADMIN_MANUAL"
  | "ADMIN_AUDITORIA";
type Cliente = { id: string; nome: string };
type Local = {
  id: string; nome: string; logradouro: string; numero: string | null; bairro: string | null;
  cidade: string; uf: string; cep: string | null; pontoReferencia: string | null;
  tipo: Tipo; ativo: boolean; clientes: Cliente[];
  origemCadastro: Origem | null;
  totalViagens: number;
  criadoPor: { id: string; nome: string } | null;
  criadoPorMotorista: { id: string; nome: string } | null;
};

const PATH = "/admin/locais";
const CLIENTES_PATH = "/admin/clientes";

const TIPO_LOCAL_COLOR: Record<Tipo, string> = {
  CARGA: "border-emerald-200 bg-emerald-50 text-emerald-900",
  DESCARGA: "border-rose-200 bg-rose-50 text-rose-900",
  AMBOS: "border-violet-200 bg-violet-50 text-violet-900",
};

// Rótulos curtos pra cada fluxo de cadastro. Registros antigos (pré-rastreio)
// vêm com origemCadastro=null → exibe "—".
const ORIGEM_LABEL: Record<Origem, string> = {
  MOTORISTA_FORMULARIO: "Motorista",
  MOTORISTA_RAPIDO: "Motorista (rápido)",
  VIAGEM_OFFLINE: "Viagem offline",
  ADMIN_MANUAL: "Admin",
  ADMIN_AUDITORIA: "Admin (auditoria)",
};

function nomeCriador(l: Local): string {
  return l.criadoPor?.nome ?? l.criadoPorMotorista?.nome ?? "—";
}

export default function LocaisPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Local>(PATH, tableState);
  const clientes = useResourceOptions<Cliente>(CLIENTES_PATH);
  const update = useUpdateResource<Record<string, unknown>, Local>(PATH, PATH);
  const token = useAuthToken();
  const [view, setView] = useState<"lista" | "mapa">("lista");
  const { viewMode, setViewMode } = useListViewMode("locais");

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
        id: "viagens",
        enableSorting: false,
        header: () => <span className="block text-center">Viagens</span>,
        cell: ({ row }) => (
          <span
            className={`block text-center text-sm tabular-nums ${
              row.original.totalViagens === 0
                ? "text-amber-600"
                : "text-muted-foreground"
            }`}
            title={
              row.original.totalViagens === 0
                ? "Nenhuma viagem usou este local"
                : undefined
            }
          >
            {row.original.totalViagens}
          </span>
        ),
      },
      {
        id: "origem",
        enableSorting: false,
        header: "Origem",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.origemCadastro
              ? ORIGEM_LABEL[row.original.origemCadastro]
              : "—"}
          </span>
        ),
      },
      {
        id: "criadoPor",
        enableSorting: false,
        header: "Criado por",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{nomeCriador(row.original)}</span>
        ),
      },
      {
        id: "acoes",
        size: 180,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-2">
            <Permitido chave="locais.editar">
              <StatusToggle
                active={row.original.ativo}
                onChange={(next) =>
                  update.mutate({ id: row.original.id, body: { ativo: next } })
                }
                size="sm"
              />
            </Permitido>
            <Link href={`/locais/${row.original.id}/ver`}>
              <Button variant="ghost" size="icon" title="Visualizar">
                <Eye className="h-4 w-4" />
              </Button>
            </Link>
            <Permitido chave="locais.editar">
              <Link href={`/locais/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            <ExcluirButton perm="locais.excluir"
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
        <div className="flex flex-wrap items-center gap-2">
          {view === "lista" && <ViewModeToggle value={viewMode} onChange={setViewMode} />}
          <Link href="/locais/em-validacao">
            <Button variant="outline">
              <AlertCircle className="h-4 w-4" /> Em validação
            </Button>
          </Link>
          <Permitido chave="locais.criar">
            <Link href="/locais/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo local
              </Button>
            </Link>
          </Permitido>
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
        viewMode={viewMode}
        renderMobileCard={(l) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
              <Badge className={TIPO_LOCAL_COLOR[l.tipo] ?? ""}>{l.tipo}</Badge>

              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{l.nome}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate">
                    {l.logradouro}
                    {l.numero ? `, ${l.numero}` : ""}
                    {l.bairro ? ` — ${l.bairro}` : ""}
                  </span>
                  <span>·</span>
                  <span>{l.cidade}/{l.uf}</span>
                  {l.clientes[0] && (
                    <>
                      <span>·</span>
                      <span title={l.clientes.map((c) => c.nome).join(", ")}>
                        {l.clientes[0].nome}
                        {l.clientes.length > 1 && (
                          <span className="ml-1 opacity-70">
                            +{l.clientes.length - 1}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span
                    className={`flex items-center gap-1 ${
                      l.totalViagens === 0 ? "text-amber-600" : ""
                    }`}
                    title={
                      l.totalViagens === 0
                        ? "Nenhuma viagem usou este local"
                        : undefined
                    }
                  >
                    <Truck className="h-3.5 w-3.5 shrink-0" />
                    {l.totalViagens} viage{l.totalViagens === 1 ? "m" : "ns"}
                  </span>
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    {nomeCriador(l)}
                  </span>
                  {l.origemCadastro && (
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      {ORIGEM_LABEL[l.origemCadastro]}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-end gap-1 text-muted-foreground">
                <Permitido chave="locais.editar">
                  <StatusToggle
                    active={l.ativo}
                    onChange={(next) =>
                      update.mutate({ id: l.id, body: { ativo: next } })
                    }
                    size="sm"
                  />
                </Permitido>
                <Link href={`/locais/${l.id}/ver`}>
                  <Button variant="ghost" size="icon" title="Visualizar">
                    <Eye className="h-4 w-4" />
                  </Button>
                </Link>
                <Permitido chave="locais.editar">
                  <Link href={`/locais/${l.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                </Permitido>
                <ExcluirButton perm="locais.excluir"
                  path="/admin/locais"
                  id={l.id}
                  nomeRecurso={`o local "${l.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
      )}
    </div>
  );
}
