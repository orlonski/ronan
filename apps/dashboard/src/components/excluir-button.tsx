"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";

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
  perm,
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
  /** Permissão exigida (ex: "motoristas.excluir"). Sem ela, não renderiza. */
  perm?: string;
}) {
  const { temPermissao } = usePermissoes();
  const token = useAuthToken();
  const qc = useQueryClient();
  const { confirmar, ConfirmDialog } = useConfirm();
  const [working, setWorking] = useState(false);

  const podeExcluir = perm ? temPermissao(perm) : false;

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

  if (!podeExcluir) return null;

  async function onClick() {
    if (working) return;
    const ok = await confirmar({
      title: `Excluir ${nomeRecurso}?`,
      description: "Essa ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      variant: "destructive",
    });
    if (!ok) return;
    setWorking(true);
    try {
      await mutation.mutateAsync();
      toast.success(`${capitalize(nomeRecurso)} excluído com sucesso.`);
    } catch (err) {
      toast.error("Não foi possível excluir", {
        description: (err as Error).message ?? "Erro ao excluir",
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
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
      <ConfirmDialog />
    </>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
