"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MapPin, Pencil, Truck, User } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { FormPageHeader } from "@/components/form-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { fmtBR } from "@/lib/fechamento-helpers";
import { useResourceItem, usePaginatedList } from "@/lib/client-api";

const PontoMap = dynamic(
  () => import("@/components/ponto-map").then((m) => m.PontoMap),
  { ssr: false, loading: () => <div className="h-64 rounded-lg border bg-muted/30" /> },
);

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";
type Nivel =
  | "RASCUNHO"
  | "PRESENCA_PONTUAL"
  | "DWELL_CONFIRMADO"
  | "RECORRENTE"
  | "HUMANO";
type Origem =
  | "MOTORISTA_FORMULARIO"
  | "MOTORISTA_RAPIDO"
  | "VIAGEM_OFFLINE"
  | "ADMIN_MANUAL"
  | "ADMIN_AUDITORIA";

type Local = {
  id: string;
  nome: string;
  logradouro: string;
  numero: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  pontoReferencia: string | null;
  tipo: Tipo;
  ativo: boolean;
  lat: number | null;
  lng: number | null;
  nivelConfianca: Nivel;
  origemCadastro: Origem | null;
  totalViagens: number;
  clientes: { id: string; nome: string }[];
  criadoPor: { id: string; nome: string } | null;
  criadoPorMotorista: { id: string; nome: string } | null;
};

type Viagem = {
  id: string;
  data: string;
  ticket: string;
  status: string;
  motorista: { id: string; nome: string };
  cliente: { id: string; nome: string };
  localCarga: { id: string; nome: string };
  localDescarga: { id: string; nome: string };
};

const TIPO_LOCAL_COLOR: Record<Tipo, string> = {
  CARGA: "border-emerald-200 bg-emerald-50 text-emerald-900",
  DESCARGA: "border-rose-200 bg-rose-50 text-rose-900",
  AMBOS: "border-violet-200 bg-violet-50 text-violet-900",
};

const NIVEL_LABEL: Record<Nivel, { label: string; cls: string }> = {
  RASCUNHO: { label: "Rascunho", cls: "bg-zinc-100 text-zinc-700" },
  PRESENCA_PONTUAL: { label: "Presença GPS", cls: "bg-blue-100 text-blue-700" },
  DWELL_CONFIRMADO: { label: "Dwell ≥10min", cls: "bg-amber-100 text-amber-700" },
  RECORRENTE: { label: "Recorrente", cls: "bg-emerald-100 text-emerald-700" },
  HUMANO: { label: "Homologado", cls: "bg-emerald-200 text-emerald-800" },
};

const ORIGEM_LABEL: Record<Origem, string> = {
  MOTORISTA_FORMULARIO: "Motorista",
  MOTORISTA_RAPIDO: "Motorista (rápido)",
  VIAGEM_OFFLINE: "Viagem offline",
  ADMIN_MANUAL: "Admin",
  ADMIN_AUDITORIA: "Admin (auditoria)",
};

const STATUS_VIAGEM_LABEL: Record<string, string> = {
  ENVIADA: "Aguardando",
  EM_CONFERENCIA: "Em conferência",
  OK: "OK",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
  RASCUNHO_OFFLINE: "Rascunho",
};

const STATUS_VIAGEM_COLOR: Record<string, string> = {
  ENVIADA: "bg-amber-100 text-amber-900 border-amber-200",
  EM_CONFERENCIA: "bg-purple-100 text-purple-800 border-purple-200",
  OK: "bg-green-100 text-green-800 border-green-200",
  DIVERGENTE: "bg-red-100 text-red-800 border-red-200",
  AJUSTADA: "bg-blue-100 text-blue-800 border-blue-200",
  RASCUNHO_OFFLINE: "bg-gray-100 text-gray-700 border-gray-200",
};

function InfoLinha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export default function VisualizarLocalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const item = useResourceItem<Local>("/admin/locais", id);
  const l = item.data;

  // Viagens deste local (carga OU descarga) — backend filtra por localId.
  const tableState = useDataTableState({ defaultSort: { field: "data", order: "desc" } });
  const viagens = usePaginatedList<Viagem>("/admin/viagens", {
    ...tableState,
    filters: { ...tableState.filters, localId: id },
  });

  function lado(v: Viagem): "Carga" | "Descarga" | "Carga e descarga" {
    const carga = v.localCarga?.id === id;
    const descarga = v.localDescarga?.id === id;
    if (carga && descarga) return "Carga e descarga";
    return carga ? "Carga" : "Descarga";
  }

  const columns = useMemo<ColumnDef<Viagem>[]>(
    () => [
      {
        id: "data",
        accessorKey: "data",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Data" />,
        cell: ({ row }) => <span className="text-sm">{fmtBR(row.original.data)}</span>,
      },
      {
        id: "ticket",
        accessorKey: "ticket",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ticket" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.ticket}</span>
        ),
      },
      {
        id: "lado",
        enableSorting: false,
        header: "Lado",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{lado(row.original)}</span>
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
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cliente" />,
        cell: ({ row }) => <span className="text-sm">{row.original.cliente.nome}</span>,
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Badge className={STATUS_VIAGEM_COLOR[row.original.status] ?? ""}>
            {STATUS_VIAGEM_LABEL[row.original.status] ?? row.original.status}
          </Badge>
        ),
      },
      {
        id: "acoes",
        size: 80,
        enableSorting: false,
        header: () => <span className="block text-center">Abrir</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Link href={`/viagens/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Abrir viagem">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={l ? l.nome : "Local"}
        backHref="/locais"
        right={
          l ? (
            <Link href={`/locais/${l.id}`}>
              <Button variant="outline">
                <Pencil className="h-4 w-4" /> Editar
              </Button>
            </Link>
          ) : undefined
        }
      />

      {item.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}

      {l && (
        <>
          <Card className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={TIPO_LOCAL_COLOR[l.tipo] ?? ""}>{l.tipo}</Badge>
              <Badge className={NIVEL_LABEL[l.nivelConfianca]?.cls}>
                {NIVEL_LABEL[l.nivelConfianca]?.label ?? l.nivelConfianca}
              </Badge>
              {!l.ativo && (
                <Badge className="bg-zinc-100 text-zinc-600">Inativo</Badge>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoLinha rotulo="Endereço">
                {l.logradouro || "—"}
                {l.numero ? `, ${l.numero}` : ""}
                {l.bairro ? ` — ${l.bairro}` : ""}
              </InfoLinha>
              <InfoLinha rotulo="Cidade/UF">
                {l.cidade ? `${l.cidade}/${l.uf}` : "—"}
              </InfoLinha>
              <InfoLinha rotulo="CEP">{l.cep || "—"}</InfoLinha>
              <InfoLinha rotulo="Ponto de referência">
                {l.pontoReferencia || "—"}
              </InfoLinha>
              <InfoLinha rotulo="Clientes">
                {l.clientes.length
                  ? l.clientes.map((c) => c.nome).join(", ")
                  : "Genérico (todos)"}
              </InfoLinha>
              <InfoLinha rotulo="Total de viagens">
                <span className="inline-flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                  {l.totalViagens}
                </span>
              </InfoLinha>
              <InfoLinha rotulo="Origem do cadastro">
                {l.origemCadastro ? ORIGEM_LABEL[l.origemCadastro] : "—"}
              </InfoLinha>
              <InfoLinha rotulo="Criado por">
                <span className="inline-flex items-center gap-1">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {l.criadoPor?.nome ?? l.criadoPorMotorista?.nome ?? "—"}
                </span>
              </InfoLinha>
            </div>
          </Card>

          {l.lat != null && l.lng != null && (
            <Card className="space-y-3 p-6">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MapPin className="h-4 w-4 text-muted-foreground" /> Localização no mapa
              </div>
              <PontoMap lat={l.lat} lng={l.lng} label={l.nome} />
              <p className="text-xs text-muted-foreground">
                Coordenadas: {l.lat.toFixed(6)}, {l.lng.toFixed(6)}.
              </p>
            </Card>
          )}

          <Card className="space-y-3 p-6">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Truck className="h-4 w-4 text-muted-foreground" /> Viagens deste local
              <span className="text-muted-foreground">({l.totalViagens})</span>
            </div>
            <DataTable
              columns={columns}
              data={viagens.data?.data ?? []}
              pagination={viagens.data?.pagination}
              state={tableState}
              isLoading={viagens.isLoading}
              isFetching={viagens.isFetching}
              emptyMessage="Nenhuma viagem usou este local ainda."
            />
          </Card>
        </>
      )}
    </div>
  );
}
