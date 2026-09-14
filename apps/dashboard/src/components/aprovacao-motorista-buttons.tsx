"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { useConfirm } from "@/components/confirm-dialog";

const PATH = "/admin/motoristas";

/**
 * Botões Aprovar / Rejeitar pra um motorista com cadastro PENDENTE_APROVACAO.
 * Aprovar libera o app pro motorista; rejeitar impede o login. Invalida a lista
 * pra a linha sair de "Pendente" na hora.
 */
export function AprovacaoMotoristaButtons({ id, nome }: { id: string; nome: string }) {
  const { confirmar, ConfirmDialog } = useConfirm();
  const token = useAuthToken();
  const qc = useQueryClient();

  const mutacao = useMutation({
    mutationFn: (status: "APROVADO" | "REJEITADO") =>
      fetchApi(`${PATH}/${id}/aprovacao`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_res, status) => {
      qc.invalidateQueries({ queryKey: [PATH] });
      toast.success(
        status === "APROVADO" ? `${nome} aprovado` : `Cadastro de ${nome} rejeitado`,
      );
    },
    onError: (err: Error) => {
      toast.error("Não foi possível atualizar", { description: err.message });
    },
  });

  async function rejeitar() {
    const ok = await confirmar({
      variant: "destructive",
      title: `Rejeitar o cadastro de ${nome}?`,
      description: "Ele não consegue entrar no app enquanto estiver rejeitado. Dá pra aprovar depois, se for engano.",
      confirmLabel: "Rejeitar cadastro",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    mutacao.mutate("REJEITADO");
  }

  return (
    <div className="flex items-center gap-1">
      <ConfirmDialog />
      <Button
        size="sm"
        title="Aprovar cadastro"
        disabled={mutacao.isPending}
        onClick={() => mutacao.mutate("APROVADO")}
        variant="success"
      >
        {mutacao.isPending ? <Spinner /> : <Check className="h-4 w-4" />}
        Aprovar
      </Button>
      <Button
        variant="outline"
        size="icon"
        title="Rejeitar cadastro"
        disabled={mutacao.isPending}
        onClick={rejeitar}
        className="text-destructive hover:bg-destructive/10"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
