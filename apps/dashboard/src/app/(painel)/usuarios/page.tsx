"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Pencil, Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { StatusToggle } from "@/components/status-toggle";
import { ConviteWhatsappButton } from "@/components/convite-whatsapp-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/data-table";
import { Combobox } from "@/components/ui/combobox";
import { useDataTableState } from "@/hooks/use-data-table-state";
import { usePaginatedList, useUpdateResource } from "@/lib/client-api";

type Perfil = "ADMIN" | "OPERADOR";
type User = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  ultimoLoginEm: string | null;
};
const PATH = "/admin/users";

function fmtUltimoLogin(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UsuariosPage() {
  const { data: session } = useSession();
  const tableState = useDataTableState({ defaultSort: { field: "nome", order: "asc" } });
  const isAdmin = session?.user?.perfil === "ADMIN";
  const list = usePaginatedList<User>(PATH, tableState, { enabled: isAdmin });
  const update = useUpdateResource<{ ativo?: boolean }, User>(PATH, PATH);

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
        id: "perfil",
        accessorKey: "perfil",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Perfil" />,
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
            disabled={row.original.email === currentEmail}
            size="sm"
            label
          />
        ),
      },
      {
        id: "acoes",
        size: 110,
        enableSorting: false,
        header: () => <span className="block text-center">Ações</span>,
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Link href={`/usuarios/${row.original.id}`}>
              <Button variant="ghost" size="icon" title="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <ConviteWhatsappButton
              tipo="user"
              id={row.original.id}
              nome={row.original.nome}
            />
          </div>
        ),
      },
    ],
    [update, currentEmail],
  );

  if (!isAdmin) {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">Acesso restrito a administradores.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">Quem acessa o painel admin.</p>
        </div>
        <Link href="/usuarios/novo">
          <Button className="w-full md:w-auto">
            <Plus className="h-4 w-4" /> Novo usuário
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
            searchPlaceholder="Buscar por nome ou email…"
            filters={
              <>
                <Combobox
                  value={tableState.filters.perfil}
                  onChange={(v) => tableState.setFilter("perfil", v)}
                  placeholder="Perfil"
                  showSearch={false}
                  options={[
                    { value: "ADMIN", label: "Admin" },
                    { value: "OPERADOR", label: "Operador" },
                  ]}
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
        emptyMessage="Nenhum usuário cadastrado."
        renderMobileCard={(u) => (
          <Card className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusToggle
                  active={u.ativo}
                  onChange={(next) => update.mutate({ id: u.id, body: { ativo: next } })}
                  disabled={u.email === currentEmail}
                  size="sm"
                  label
                />
                <Link href={`/usuarios/${u.id}`}>
                  <Button variant="ghost" size="icon" title="Editar">
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Link>
                <ConviteWhatsappButton tipo="user" id={u.id} nome={u.nome} />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span>
                <span className="text-muted-foreground">Perfil: </span>
                {u.perfil}
              </span>
              <span>
                <span className="text-muted-foreground">Último login: </span>
                {fmtUltimoLogin(u.ultimoLoginEm)}
              </span>
            </div>
          </Card>
        )}
      />
    </div>
  );
}
