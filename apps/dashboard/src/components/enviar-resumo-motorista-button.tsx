"use client";

import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

/**
 * Envia o resumo diário AGORA pro WhatsApp do motorista (pra testar sem esperar
 * as 20h). Desabilitado quando o motorista não tem telefone. O backend responde
 * { enviado, motivo? } — mostra o motivo quando não enviou (sem telefone, opt-out…).
 */
export function EnviarResumoMotoristaButton({
  motoristaId,
  nome,
  temTelefone,
}: {
  motoristaId: string;
  nome: string;
  temTelefone: boolean;
}) {
  const token = useAuthToken();

  const enviar = useMutation({
    mutationFn: () =>
      fetchApi<{ enviado: boolean; motivo?: string }>(
        `/admin/motoristas/${motoristaId}/enviar-resumo`,
        { method: "POST", token },
      ),
    onSuccess: (r) => {
      if (r.enviado) {
        toast.success("Resumo enviado", { description: `WhatsApp de ${nome}.` });
      } else {
        toast.error("Não enviado", { description: r.motivo ?? "Motivo desconhecido." });
      }
    },
    onError: (err: Error) => {
      toast.error("Não foi possível enviar", { description: err.message });
    },
  });

  return (
    <Button
      variant="ghost"
      size="icon"
      title={temTelefone ? "Enviar resumo do dia agora" : "Motorista sem telefone"}
      disabled={!temTelefone || enviar.isPending}
      onClick={() => enviar.mutate()}
      className="text-muted-foreground hover:bg-blue-50 hover:text-blue-700"
    >
      {enviar.isPending ? <Spinner /> : <Send className="h-4 w-4" />}
    </Button>
  );
}
