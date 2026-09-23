"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Columns3, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Permitido } from "@/components/requer-tela";
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
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";
import { AbasDaTela } from "@/components/abas-da-tela";

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
  const { confirmar, ConfirmDialog } = useConfirm();
  const token = useAuthToken();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: [PATH],
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
  return (
    <div className="space-y-6">
    <ConfirmDialog />
      <AbasDaTela grupo="fechamento" />
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Columns3 className="h-6 w-6 text-amber-600" />
            Como ler a planilha do cliente
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Quais colunas a leitura automática reconhece quando abre uma planilha
            de fechamento. Adicione aqui pra que apareçam na tela de importação da
            empresa. Colunas com 🔒 vêm de fábrica (não podem ser
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
                  <Permitido chave="config-campos-layout.editar">
                    <Link href={`/configuracoes/campos-layout/${c.id}`}>
                      <Button variant="ghost" size="icon" title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </Link>
                  </Permitido>
                  {!c.sistema && (
                    <Button
                      variant="destructive"
                      size="icon"
                      aria-label={`Excluir o campo ${c.label}`}
                      onClick={async () => {
                        const ok = await confirmar({
                          variant: "destructive",
                          title: `Excluir o campo "${c.label}"?`,
                          description:
                            "As planilhas que usavam essa coluna param de reconhecê-la na próxima leitura.",
                          confirmLabel: "Excluir campo",
                          cancelLabel: "Voltar",
                        });
                        if (!ok) return;
                        try {
                          await remove.mutateAsync(c.id);
                        } catch (err) {
                          toast.error("Não consegui excluir o campo", {
                            description: (err as Error).message || "Tente de novo em alguns instantes.",
                          });
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
