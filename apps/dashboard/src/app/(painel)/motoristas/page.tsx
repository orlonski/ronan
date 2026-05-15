"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileText, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  formatCpf,
  formatTelefone,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { StatusToggle } from "@/components/status-toggle";
import { ExcluirButton } from "@/components/excluir-button";
import { ConviteWhatsappButton } from "@/components/convite-whatsapp-button";
import { EnviarPushButton } from "@/components/enviar-push-button";
import { DocumentosBadge } from "@/components/documentos-badge";
import { DocumentosDrawerButton } from "@/components/documentos-drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
  ToolbarFilterSelect,
} from "@/components/data-table";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Veiculo = { id: string; placa: string; modelo: string | null };
type DocumentoResumo = { tipo: TipoDocumentoMotorista; validade: string | null };
type Motorista = {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  email: string | null;
  ativo: boolean;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
  veiculos: Veiculo[];
  documentos: DocumentoResumo[];
  temPushToken: boolean;
};
const PATH = "/admin/motoristas";

export default function MotoristasPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Motorista>(PATH, tableState);
  const update = useUpdateResource<{ ativo?: boolean }, Motorista>(PATH, PATH);

  const columns = useMemo<ColumnDef<Motorista>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "cpf",
        accessorKey: "cpf",
        header: ({ column }) => <DataTableColumnHeader column={column} title="CPF" />,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{formatCpf(row.original.cpf)}</span>
        ),
      },
      {
        id: "telefone",
        accessorKey: "telefone",
        enableSorting: false,
        header: "Telefone",
        cell: ({ row }) =>
          row.original.telefone ? formatTelefone(row.original.telefone) : "—",
      },
      {
        id: "email",
        accessorKey: "email",
        enableSorting: false,
        header: "Email",
        cell: ({ row }) => (
          <span className="text-xs">{row.original.email ?? "—"}</span>
        ),
      },
      {
        id: "placas",
        enableSorting: false,
        header: "Placas",
        cell: ({ row }) =>
          row.original.veiculos.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.veiculos.map((v) => (
                <span
                  key={v.id}
                  className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                    v.id === row.original.veiculoDefaultId
                      ? "bg-blue-100 text-blue-700"
                      : "bg-muted text-muted-foreground"
                  }`}
                  title={v.id === row.original.veiculoDefaultId ? "Padrão" : undefined}
                >
                  {v.placa}
                </span>
              ))}
            </div>
          ),
      },
      {
        id: "documentos",
        enableSorting: false,
        size: 64,
        header: () => <span className="block text-center">Docs</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <DocumentosBadge
              motoristaId={row.original.id}
              motoristaNome={row.original.nome}
              documentos={row.original.documentos ?? []}
            />
          </div>
        ),
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 96,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <StatusToggle
            active={row.original.ativo}
            onChange={(next) =>
              update.mutate({ id: row.original.id, body: { ativo: next } })
            }
            size="sm"
            label
          />
        ),
      },
      {
        id: "acoes",
        size: 220,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <DocumentosDrawerButton
              motoristaId={row.original.id}
              motoristaNome={row.original.nome}
            >
              {(open) => (
                <Button variant="ghost" size="icon" title="Documentos" onClick={open}>
                  <FileText className="h-4 w-4" />
                </Button>
              )}
            </DocumentosDrawerButton>
            <Link href={`/motoristas/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <EnviarPushButton
              motoristaId={row.original.id}
              motoristaNome={row.original.nome}
              temPushToken={row.original.temPushToken}
            />
            <ConviteWhatsappButton tipo="motorista" id={row.original.id} nome={row.original.nome} />
            <ExcluirButton
              path="/admin/motoristas"
              id={row.original.id}
              nomeRecurso={`o motorista "${row.original.nome}"`}
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
          <h1 className="text-2xl font-semibold tracking-tight">Motoristas</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de motoristas e suas placas. Cada motorista pode ter várias placas.
          </p>
        </div>
        <Link href="/motoristas/novo">
          <Button className="w-full md:w-auto">
            <Plus className="h-4 w-4" /> Novo motorista
          </Button>
        </Link>
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
            searchPlaceholder="Buscar por nome, CPF, telefone, email…"
            filters={
              <ToolbarFilterSelect
                label="Status"
                value={tableState.filters.ativo}
                onChange={(v) => tableState.setFilter("ativo", v)}
                options={[
                  { value: "true", label: "Ativos" },
                  { value: "false", label: "Inativos" },
                ]}
              />
            }
          />
        }
        emptyMessage="Nenhum motorista encontrado."
        renderMobileCard={(m) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.nome}</p>
                <p className="font-mono text-xs text-muted-foreground">{formatCpf(m.cpf)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={m.ativo}
                  onChange={(next) => update.mutate({ id: m.id, body: { ativo: next } })}
                  size="sm"
                  label
                />
                <DocumentosDrawerButton motoristaId={m.id} motoristaNome={m.nome}>
                  {(open) => (
                    <Button variant="ghost" size="icon" title="Documentos" onClick={open}>
                      <FileText className="h-4 w-4" />
                    </Button>
                  )}
                </DocumentosDrawerButton>
                <Link href={`/motoristas/${m.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <EnviarPushButton
                  motoristaId={m.id}
                  motoristaNome={m.nome}
                  temPushToken={m.temPushToken}
                />
                <ConviteWhatsappButton tipo="motorista" id={m.id} nome={m.nome} />
                <ExcluirButton
                  path="/admin/motoristas"
                  id={m.id}
                  nomeRecurso={`o motorista "${m.nome}"`}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {m.telefone && (
                <span>
                  <span className="text-muted-foreground">Tel: </span>
                  {formatTelefone(m.telefone)}
                </span>
              )}
              {m.email && (
                <span>
                  <span className="text-muted-foreground">Email: </span>
                  {m.email}
                </span>
              )}
            </div>
            {m.veiculos.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {m.veiculos.map((v) => (
                  <span
                    key={v.id}
                    className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                      v.id === m.veiculoDefaultId
                        ? "bg-blue-100 text-blue-700"
                        : "bg-muted text-muted-foreground"
                    }`}
                    title={v.id === m.veiculoDefaultId ? "Padrão" : undefined}
                  >
                    {v.placa}
                  </span>
                ))}
              </div>
            )}
          </Card>
        )}
      />
    </div>
  );
}
