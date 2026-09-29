"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { descreverConferencia, type ConferenciaDoMotorista } from "../_components/conferencia-interruptor";

/**
 * O selo do cadastro: o WhatsApp deste número parece não entregar, ou o parceiro
 * pediu pra parar a pergunta de viagens. Só informa — não muda acesso, status
 * nem aviso nenhum. "Reverificar" limpa a suspeita (o número está certo).
 */
export function WhatsappSuspeitoCard({
  motoristaId,
  inalcancavelEm,
  conferencia,
}: {
  motoristaId: string;
  inalcancavelEm: string | null | undefined;
  conferencia: ConferenciaDoMotorista;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { temPermissao, temModulo } = usePermissoes();
  const parouConferencia = conferencia.receberConferenciaDiaria === false;
  const fraseConferencia = descreverConferencia(conferencia);
  const reverificar = useMutation({
    mutationFn: () =>
      fetchApi(`/admin/conferencia-diaria/motoristas/${motoristaId}/reverificar-whatsapp`, {
        method: "POST",
        token,
      }),
    onSuccess: () => {
      toast.success("Número reverificado.");
      void qc.invalidateQueries();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não deu pra reverificar."),
  });

  if (!inalcancavelEm && !parouConferencia) return null;
  return (
    <Card className="flex flex-wrap items-start justify-between gap-3 border-amber-300 bg-amber-50 p-4 text-amber-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="space-y-1 text-sm">
          {inalcancavelEm && (
            <>
              <p className="font-medium">WhatsApp suspeito: as mensagens não estão chegando</p>
              <p>
                Desde {new Date(inalcancavelEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} a
                Meta não confirma entrega neste número. A conferência de viagens parou de perguntar a ele — contate
                por outro meio. O acesso e os outros avisos continuam como estavam.
              </p>
            </>
          )}
          {parouConferencia && (
            <p data-testid="ficha-conferencia-estado">
              <span className="font-medium">Conferência de viagens no WhatsApp desligada.</span> {fraseConferencia}
              {conferencia.conferenciaDesligadaMotivo ? ` Motivo: ${conferencia.conferenciaDesligadaMotivo}` : ""}{" "}
              Vale só para este cadastro.
            </p>
          )}
        </div>
      </div>
      {inalcancavelEm && temPermissao("conferencia-diaria.decidir") && temModulo("conferencia-diaria.decidir") && (
        <Button variant="outline" onClick={() => reverificar.mutate()} disabled={reverificar.isPending}>
          Reverificar número
        </Button>
      )}
    </Card>
  );
}
