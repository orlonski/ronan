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
 * Botão de exclusão definitiva (hard delete) com confirmação, tratamento de
 * erro do backend e invalidação da listagem.
 *
 * Nasce VERMELHO. O default era `ghost` — cinza — em 23 telas, contrariando o
 * `docs/padrao-botoes.md`, que diz que um "excluir" nunca pode ter cor neutra.
 * Quem quiser o botão discreto pede `variant="ghost"` de propósito.
 *
 * `descricaoConfirmacao` existe porque "Essa ação não pode ser desfeita" nem
 * sempre é verdade: pedido com programação, por exemplo, é CANCELADO pelo
 * backend, não apagado.
 */
export function ExcluirButton({
  path,
  id,
  nomeRecurso,
  invalidateKeys,
  onSuccess,
  size = "icon",
  variant = "destructive",
  disabled = false,
  label,
  perm,
  descricaoConfirmacao,
  rotuloConfirmar = "Excluir",
  tituloConfirmacao,
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
  /** O que acontece de verdade. Default: "Essa ação não pode ser desfeita." */
  descricaoConfirmacao?: string;
  /** Verbo do botão que confirma. Default: "Excluir". */
  rotuloConfirmar?: string;
  /** Sobrescreve "Excluir <nomeRecurso>?" quando a ação não é exclusão. */
  tituloConfirmacao?: string;
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
      title: tituloConfirmacao ?? `Excluir ${nomeRecurso}?`,
      description: descricaoConfirmacao ?? "Essa ação não pode ser desfeita.",
      confirmLabel: rotuloConfirmar,
      variant: "destructive",
    });
    if (!ok) return;
    setWorking(true);
    try {
      await mutation.mutateAsync();
      toast.success(`${capitalize(nomeRecurso)} saiu da lista.`);
    } catch (err) {
      toast.error("Não foi possível excluir", {
        description: (err as Error).message || "Tente de novo em alguns instantes.",
      });
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={onClick}
        disabled={disabled || working}
        title={tituloConfirmacao ?? "Excluir definitivamente"}
        aria-label={label ? undefined : (tituloConfirmacao ?? `Excluir ${nomeRecurso}`)}
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
