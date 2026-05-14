"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusToggle } from "@/components/status-toggle";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Campo = {
  id: string;
  slug: string;
  label: string;
  ordem: number;
  ativo: boolean;
  sistema: boolean;
  tipo: "TEXTO" | "NUMERO" | "DATA";
  descricao: string | null;
};

const PATH = "/admin/campos-layout";

export default function CamposLayoutPage() {
  const { data: session } = useSession();
  const token = useAuthToken();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: [PATH, token],
    enabled: !!token,
    queryFn: () => fetchApi<Campo[]>(PATH, { token }),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Campo> }) =>
      fetchApi<Campo>(`${PATH}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PATH] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      fetchApi<void>(`${PATH}/${id}`, { method: "DELETE", token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [PATH] }),
  });

  if (session?.user?.perfil !== "ADMIN") {
    return (
      <div className="rounded-md border bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">
          Acesso restrito a administradores.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="h-6 w-6 text-amber-600" />
            Campos do layout de importação
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Quais campos a IA reconhece quando lê uma planilha de fechamento.
            Adicione campos novos aqui pra que apareçam no dropdown da tela de
            layout de importação. Campos com 🔒 são embarcados (não podem ser
            deletados nem ter slug alterado) — são os usados em match e
            comparação.
          </p>
        </div>
        <Link href="/configuracoes/campos-layout/novo">
          <Button>
            <Plus className="h-4 w-4" /> Novo campo
          </Button>
        </Link>
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-24">Ordem</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>Carregando...</TableCell>
              </TableRow>
            )}
            {list.data?.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1">
                    {c.sistema && <Lock className="h-3 w-3 text-muted-foreground" />}
                    {c.label}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                <TableCell className="text-xs">{c.tipo}</TableCell>
                <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                  {c.descricao ?? "—"}
                </TableCell>
                <TableCell className="text-xs">{c.ordem}</TableCell>
                <TableCell>
                  <StatusToggle
                    active={c.ativo}
                    onChange={(next) =>
                      update.mutate({ id: c.id, body: { ativo: next } })
                    }
                    size="sm"
                    label
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/configuracoes/campos-layout/${c.id}`}>
                    <Button variant="ghost" size="icon" title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                  {!c.sistema && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        if (!confirm(`Deletar campo "${c.label}"?`)) return;
                        try {
                          await remove.mutateAsync(c.id);
                        } catch (err) {
                          alert((err as Error).message);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Nenhum campo cadastrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
