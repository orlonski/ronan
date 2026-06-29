"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Pencil, Plus, UserCircle } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { ConviteWhatsappButton } from "@/components/convite-whatsapp-button";
import { EnviarResumoButton } from "@/components/enviar-resumo-button";
import { Permitido } from "@/components/requer-tela";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { useListViewMode } from "@/hooks/use-list-view-mode";
import { usePaginatedList, useUpdateResource } from "@/lib/client-api";

type User = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  ultimoLoginEm: string | null;
  whatsappResumo: string | null;
  receberResumoDiario: boolean;
  papel: { id: string; nome: string } | null;
  criadoPor: { id: string; nome: string } | null;
};
const PATH = "/admin/users";

function fmtUltimoLogin(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UsuariosPage() {
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const list = usePaginatedList<User>(PATH, tableState);
  const update = useUpdateResource<{ ativo?: boolean }, User>(PATH, PATH);
  const { viewMode, setViewMode } = useListViewMode("usuarios");
  const { data: session } = useSession();

  const currentEmail = session?.user?.email ?? "";

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        id: "nome",
        accessorKey: "nome",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />,
        cell: ({ row }) => <span className="font-medium">{row.original.nome}</span>,
      },
      {
        id: "email",
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
      },
      {
        id: "papel",
        enableSorting: false,
        header: () => <span>Papel</span>,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.papel?.nome ?? "—"}</span>
        ),
      },
      {
        id: "ultimoLoginEm",
        accessorKey: "ultimoLoginEm",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Último login" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {fmtUltimoLogin(row.original.ultimoLoginEm)}
          </span>
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
        id: "ativo",
        accessorKey: "ativo",
        size: 96,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <Permitido chave="usuarios.editar">
            <StatusToggle
              active={row.original.ativo}
              onChange={(next) =>
                update.mutate({ id: row.original.id, body: { ativo: next } })
              }
              disabled={row.original.email === currentEmail}
              size="sm"
              label
            />
          </Permitido>
        ),
      },
      {
        id: "acoes",
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Permitido chave="usuarios.editar">
              <Link href={`/usuarios/${row.original.id}`}>
                <Button variant="ghost" size="icon" title="Editar">
                  <Pencil className="h-4 w-4" />
                </Button>
              </Link>
            </Permitido>
            <ConviteWhatsappButton
              tipo="user"
              id={row.original.id}
              nome={row.original.nome}
            />
            {row.original.whatsappResumo && (
              <EnviarResumoButton
                userId={row.original.id}
                nome={row.original.nome}
              />
            )}
          </div>
        ),
      },
    ],
    [update, currentEmail],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">Quem acessa o painel admin.</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <Permitido chave="usuarios.criar">
            <Link href="/usuarios/novo">
              <Button>
                <Plus className="h-4 w-4" /> Novo usuário
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
            searchPlaceholder="Buscar por nome ou email…"
            filters={
              <>
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
        emptyMessage="Nenhum usuário cadastrado."
        viewMode={viewMode}
        renderMobileCard={(u) => (
          <Card className="overflow-hidden border-border/60 p-0 transition-all hover:border-border hover:shadow-md">
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6">
              <Badge className="border-slate-200 bg-slate-50 text-slate-800">
                {u.papel?.nome ?? "—"}
              </Badge>

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <UserCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{u.nome}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="truncate">{u.email}</span>
                  <span>·</span>
                  <span>Último login: {fmtUltimoLogin(u.ultimoLoginEm)}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <Permitido chave="usuarios.editar">
                  <StatusToggle
                    active={u.ativo}
                    onChange={(next) =>
                      update.mutate({ id: u.id, body: { ativo: next } })
                    }
                    disabled={u.email === currentEmail}
                    size="sm"
                  />
                </Permitido>
                <Permitido chave="usuarios.editar">
                  <Link href={`/usuarios/${u.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                </Permitido>
                <ConviteWhatsappButton tipo="user" id={u.id} nome={u.nome} />
                {u.whatsappResumo && (
                  <EnviarResumoButton userId={u.id} nome={u.nome} />
                )}
              </div>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
