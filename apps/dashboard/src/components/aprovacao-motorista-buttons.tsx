"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

const PATH = "/admin/motoristas";

/**
 * Botões Aprovar / Rejeitar pra um motorista com cadastro PENDENTE_APROVACAO.
 * Aprovar libera o app pro motorista; rejeitar impede o login. Invalida a lista
 * pra a linha sair de "Pendente" na hora.
 */
export function AprovacaoMotoristaButtons({ id, nome }: { id: string; nome: string }) {
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

  function rejeitar() {
    if (!confirm(`Rejeitar o cadastro de "${nome}"? Ele não vai conseguir entrar no app.`)) return;
    mutacao.mutate("REJEITADO");
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        title="Aprovar cadastro"
        disabled={mutacao.isPending}
        onClick={() => mutacao.mutate("APROVADO")}
        className="bg-emerald-600 hover:bg-emerald-700"
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
