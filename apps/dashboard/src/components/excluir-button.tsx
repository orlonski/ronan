"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Trash2 } from "lucide-react";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { Button } from "@/components/ui/button";

/**
 * Botão de exclusão definitiva (hard delete) com:
 * - Confirmação via window.confirm
 * - Tratamento de erro 409 (ConflictException) mostrando a mensagem do backend
 * - Invalidação do queryKey de listagem após sucesso
 *
 * Visível apenas pra perfil ADMIN.
 */
export function ExcluirButton({
  path,
  id,
  nomeRecurso,
  invalidateKeys,
  onSuccess,
  size = "icon",
  variant = "ghost",
  disabled = false,
  label,
}: {
  /** Path base do endpoint admin (ex: "/admin/motoristas") */
  path: string;
  id: string;
  /** Nome do recurso pra exibir na confirmação (ex: "este motorista") */
  nomeRecurso: string;
  /** Chaves do TanStack Query a invalidar após sucesso */
  invalidateKeys?: (string | string[])[];
  onSuccess?: () => void;
  size?: "icon" | "sm" | "default";
  variant?: "ghost" | "outline" | "destructive";
  disabled?: boolean;
  /** Quando size != "icon", texto do botão */
  label?: string;
}) {
  const { data: session } = useSession();
  const token = useAuthToken();
  const qc = useQueryClient();
  const [working, setWorking] = useState(false);

  const isAdmin = session?.user?.perfil === "ADMIN";

  const mutation = useMutation({
    mutationFn: () =>
      fetchApi<void>(`${path}/${id}`, { method: "DELETE", token }),
    onSuccess: () => {
      for (const k of invalidateKeys ?? [path]) {
        const key = Array.isArray(k) ? k : [k];
        void qc.invalidateQueries({ queryKey: key });
      }
      onSuccess?.();
    },
  });

  if (!isAdmin) return null;

  async function onClick() {
    if (working) return;
    if (!window.confirm(`Excluir definitivamente ${nomeRecurso}?\n\nEssa ação NÃO pode ser desfeita.`)) return;
    setWorking(true);
    try {
      await mutation.mutateAsync();
    } catch (err) {
      window.alert((err as Error).message ?? "Erro ao excluir");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Button
      variant={variant === "ghost" ? "ghost" : variant}
      size={size}
      onClick={onClick}
      disabled={disabled || working}
      title="Excluir definitivamente"
      className={
        variant === "ghost"
          ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          : undefined
      }
    >
      <Trash2 className="h-4 w-4" />
      {label && size !== "icon" ? <span>{label}</span> : null}
    </Button>
  );
}
