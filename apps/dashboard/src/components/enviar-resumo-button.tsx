"use client";

import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

/**
 * Botão pra enviar o resumo diário atualizado AGORA pro WhatsApp do usuário.
 * Só faz sentido quando o usuário tem número configurado (whatsappResumo).
 */
export function EnviarResumoButton({
  userId,
  nome,
}: {
  userId: string;
  nome: string;
}) {
  const token = useAuthToken();

  const enviar = useMutation({
    mutationFn: () =>
      fetchApi<{ ok: true }>(`/admin/resumo/enviar/${userId}`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      toast.success("Resumo enviado", { description: `WhatsApp de ${nome}.` });
    },
    onError: (err: Error) => {
      toast.error("Não foi possível enviar", { description: err.message });
    },
  });

  return (
    <Button
      variant="ghost"
      size="icon"
      title="Enviar resumo agora"
      disabled={enviar.isPending}
      onClick={() => enviar.mutate()}
      className="text-muted-foreground hover:bg-blue-50 hover:text-blue-700"
    >
      {enviar.isPending ? <Spinner /> : <Send className="h-4 w-4" />}
    </Button>
  );
}
