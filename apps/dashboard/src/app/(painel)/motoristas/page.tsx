"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileText, HardHat, Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  formatCpf,
  formatTelefone,
  type StatusMotorista,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { StatusToggle } from "@/components/status-toggle";
import { StatusCadastroBadge } from "@/components/status-cadastro-badge";
import { AprovacaoMotoristaButtons } from "@/components/aprovacao-motorista-buttons";
import { ExcluirButton } from "@/components/excluir-button";
import { ConviteWhatsappButton } from "@/components/convite-whatsapp-button";
import { EnviarPushButton } from "@/components/enviar-push-button";
import { EnviarResumoMotoristaButton } from "@/components/enviar-resumo-motorista-button";
import { DocumentosBadge } from "@/components/documentos-badge";
import { DocumentosDrawerButton } from "@/components/documentos-drawer";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { AppVersaoCell, type AppVersaoInfo } from "@/components/app-versao-badge";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList, useUpdateResource, useApiQuery } from "@/lib/client-api";

type Veiculo = { id: string; placa: string; modelo: string | null };
type DocumentoResumo = { tipo: TipoDocumentoMotorista; validade: string | null };
type Motorista = AppVersaoInfo & {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  email: string | null;
  ativo: boolean;
  status: StatusMotorista;
  aprovadoEm: string | null;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
  veiculos: Veiculo[];
  documentos: DocumentoResumo[];
  temPushToken: boolean;
  criadoPor: { id: string; nome: string } | null;
};
type ResumoVersoes = {
  latestVersion: string | null;
  latestUpdateId: string | null;
  latestBuiltAt: string | null;
  fonte: "eas" | "motoristas";
};
const PATH = "/admin/motoristas";

export default function MotoristasPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<Motorista>(PATH, tableState);
  const update = useUpdateResource<{ ativo?: boolean }, Motorista>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("motoristas");
  const resumo = useApiQuery<ResumoVersoes>(`${PATH}/versoes/resumo`, {
    staleTime: 60_000,
  });
  const latest = useMemo(
    () => ({
      latestUpdateId: resumo.data?.latestUpdateId ?? null,
      latestBuiltAt: resumo.data?.latestBuiltAt ?? null,
      degradado: resumo.data?.fonte === "motoristas",
    }),
    [resumo.data?.latestUpdateId, resumo.data?.latestBuiltAt, resumo.data?.fonte],
  );

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
        id: "appVersao",
        enableSorting: false,
        header: "Versão app",
        cell: ({ row }) => (
          <AppVersaoCell motorista={row.original} latest={latest} />
        ),
      },
      {
        id: "criadoPor",
        enableSorting: false,
        header: "Criado por",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.criadoPor?.nome ?? "—"}
          </span>
        ),
      },
      {
        id: "status",
        enableSorting: false,
        size: 96,
        header: "Cadastro",
        cell: ({ row }) => <StatusCadastroBadge status={row.original.status} />,
      },
      {
        id: "ativo",
        accessorKey: "ativo",
        size: 96,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ativo" />,
        cell: ({ row }) => (
          <Permitido chave="motoristas.editar">
            <StatusToggle
              active={row.original.ativo}
              onChange={(next) =>
                update.mutate({ id: row.original.id, body: { ativo: next } })
              }
              size="sm"
              label
            />
          </Permitido>
        ),
      },
      {
        id: "acoes",
        size: 300,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex items-center justify-center gap-1">
            {row.original.status === "PENDENTE_APROVACAO" && (
              <Permitido chave="motoristas.aprovar">
                <AprovacaoMotoristaButtons id={row.original.id} nome={row.original.nome} />
              </Permitido>
            )}
            <Permitido chave="motoristas.documentos">
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
            </Permitido>
            <Permitido chave="motoristas.editar">
              <Link href={`/motoristas/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            <Permitido chave="motoristas.editar">
              <EnviarPushButton
                motoristaId={row.original.id}
                motoristaNome={row.original.nome}
                temPushToken={row.original.temPushToken}
              />
            </Permitido>
            <Permitido chave="motoristas.editar">
              <EnviarResumoMotoristaButton
                motoristaId={row.original.id}
                nome={row.original.nome}
                temTelefone={!!row.original.telefone}
              />
            </Permitido>
            <Permitido chave="motoristas.editar">
              <ConviteWhatsappButton tipo="motorista" id={row.original.id} nome={row.original.nome} />
            </Permitido>
            <ExcluirButton perm="motoristas.excluir"
              path="/admin/motoristas"
              id={row.original.id}
              nomeRecurso={`o motorista "${row.original.nome}"`}
            />
          </div>
        ),
      },
    ],
    [update, latest],
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
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="motoristas.criar">
            <Link href="/motoristas/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo motorista
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
        toolbar={
          <DataTableToolbar
            state={tableState}
            searchPlaceholder="Buscar por nome, CPF, telefone, email…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.status}
                  onChange={(v) => tableState.setFilter("status", v)}
                  placeholder="Cadastro"
                  showSearch={false}
                  options={[
                    { value: "PENDENTE_APROVACAO", label: "Pendentes" },
                    { value: "APROVADO", label: "Aprovados" },
                    { value: "REJEITADO", label: "Rejeitados" },
                  ]}
                />
                <Combobox
                  value={tableState.filters.ativo}
                  onChange={(v) => tableState.setFilter("ativo", v)}
                  placeholder="Ativo"
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
        emptyMessage="Nenhum motorista encontrado."
        viewMode={viewMode}
        renderMobileCard={(m) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
              <DocumentosBadge
                motoristaId={m.id}
                motoristaNome={m.nome}
                documentos={m.documentos}
              />

              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <HardHat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{m.nome}</span>
                  <StatusCadastroBadge status={m.status} />
                </div>
                {m.status === "PENDENTE_APROVACAO" && (
                  <AprovacaoMotoristaButtons id={m.id} nome={m.nome} />
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono">{formatCpf(m.cpf)}</span>
                  {m.telefone && (
                    <>
                      <span>·</span>
                      <span>{formatTelefone(m.telefone)}</span>
                    </>
                  )}
                  {m.email && (
                    <>
                      <span>·</span>
                      <span className="truncate">{m.email}</span>
                    </>
                  )}
                  {m.veiculos.length > 0 && (
                    <>
                      <span>·</span>
                      <span className="flex flex-wrap gap-1">
                        {m.veiculos.map((v) => (
                          <span
                            key={v.id}
                            className={`rounded px-1.5 py-0.5 font-mono ${
                              v.id === m.veiculoDefaultId
                                ? "bg-blue-100 text-blue-700"
                                : "bg-muted text-muted-foreground"
                            }`}
                            title={v.id === m.veiculoDefaultId ? "Padrão" : undefined}
                          >
                            {v.placa}
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                </div>
                <AppVersaoCell motorista={m} latest={latest} />
              </div>

              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Permitido chave="motoristas.editar">
                  <StatusToggle
                    active={m.ativo}
                    onChange={(next) =>
                      update.mutate({ id: m.id, body: { ativo: next } })
                    }
                    size="sm"
                  />
                </Permitido>
                <Permitido chave="motoristas.documentos">
                  <DocumentosDrawerButton motoristaId={m.id} motoristaNome={m.nome}>
                    {(open) => (
                      <Button variant="ghost" size="icon" title="Documentos" onClick={open}>
                        <FileText className="h-4 w-4" />
                      </Button>
                    )}
                  </DocumentosDrawerButton>
                </Permitido>
                <Permitido chave="motoristas.editar">
                  <Link href={`/motoristas/${m.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                </Permitido>
                <Permitido chave="motoristas.editar">
                  <EnviarPushButton
                    motoristaId={m.id}
                    motoristaNome={m.nome}
                    temPushToken={m.temPushToken}
                  />
                </Permitido>
                <Permitido chave="motoristas.editar">
                  <EnviarResumoMotoristaButton
                    motoristaId={m.id}
                    nome={m.nome}
                    temTelefone={!!m.telefone}
                  />
                </Permitido>
                <Permitido chave="motoristas.editar">
                  <ConviteWhatsappButton tipo="motorista" id={m.id} nome={m.nome} />
                </Permitido>
                <ExcluirButton perm="motoristas.excluir"
                  path="/admin/motoristas"
                  id={m.id}
                  nomeRecurso={`o motorista "${m.nome}"`}
                />
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
