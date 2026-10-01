"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import type { ResultadoConfirmarTelefones } from "@ronan/shared-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";

/** O que a API diz sobre o telefone de um motorista (`GET /admin/conferencia-diaria/motoristas/:id/numero`). */
export type NumeroDoMotorista = {
  motoristaId: string;
  temTelefone: boolean;
  confirmado: boolean;
  sinais: { sinal: string; rotulo: string }[];
  telefoneConfirmadoEm: string | null;
  telefoneConfirmadoPor: { id: string; nome: string } | null;
  /** Responderam "número errado" à pergunta. */
  numeroErrado: boolean;
  /** A empresa só pergunta a número confirmado? */
  soPerguntarNumeroConfirmado: boolean;
};

const PATH = "/admin/conferencia-diaria";
export const caminhoNumero = (motoristaId: string) => `${PATH}/motoristas/${motoristaId}/numero`;

export function useNumeroDoMotorista(motoristaId: string, enabled = true) {
  return useApiQuery<NumeroDoMotorista>(caminhoNumero(motoristaId), { staleTime: 30_000, enabled });
}

/**
 * "Confirmar número": o escritório garante que o telefone é do motorista. Serve uma pessoa ou a
 * lista inteira (a API é a mesma, com uma lista de ids). Depois de confirmar, recarrega tudo que
 * depende disso (lista do dia, ficha, selo).
 */
export function useConfirmarTelefones(aoConfirmar?: (r: ResultadoConfirmarTelefones, ids: string[]) => void) {
  const token = useAuthToken();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1
        ? fetchApi<ResultadoConfirmarTelefones>(`${PATH}/motoristas/${ids[0]}/confirmar-telefone`, { method: "POST", token })
        : fetchApi<ResultadoConfirmarTelefones>(`${PATH}/confirmar-telefones`, {
            method: "POST",
            token,
            body: JSON.stringify({ motoristaIds: ids }),
          }),
    onSuccess: (r, ids) => {
      toast.success(
        r.confirmados === 1 ? "Número confirmado." : `${r.confirmados} números confirmados.`,
        { duration: 2500 },
      );
      void qc.invalidateQueries();
      aoConfirmar?.(r, ids);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não deu pra confirmar. Nada mudou."),
  });
}

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * O selo da ficha: "Número confirmado" ou "Número não confirmado" (ou "Número errado"), com o botão de
 * confirmar pra quem decide. Só informa e confirma: não muda acesso, status nem o telefone.
 */
export function NumeroConfirmadoCard({ motoristaId }: { motoristaId: string }) {
  const { temPermissao } = usePermissoes();
  const podeDecidir = temPermissao("conferencia-diaria.decidir");
  const q = useNumeroDoMotorista(motoristaId);
  const confirmar = useConfirmarTelefones();
  const n = q.data;
  if (!n || !n.temTelefone) return null;

  const motivos = n.sinais.map((s) => s.rotulo).join(", ");
  const quem = n.telefoneConfirmadoPor?.nome;
  return (
    <Card className="flex flex-wrap items-start justify-between gap-3 p-4" data-testid="numero-confirmado-card">
      <div className="flex items-start gap-3">
        {n.confirmado ? (
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
        ) : (
          <PhoneCall className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden />
        )}
        <div className="space-y-1 text-sm">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Telefone do WhatsApp
            {n.numeroErrado ? (
              <Badge className="bg-red-100 text-red-800" data-testid="selo-numero">
                Número errado
              </Badge>
            ) : n.confirmado ? (
              <Badge className="bg-emerald-100 text-emerald-800" data-testid="selo-numero">
                Número confirmado
              </Badge>
            ) : (
              <Badge className="bg-amber-100 text-amber-900" data-testid="selo-numero">
                Número não confirmado
              </Badge>
            )}
          </p>
          {n.numeroErrado ? (
            <p className="text-muted-foreground">
              Responderam que este número não é dele. A conferência parou de perguntar. Corrija o telefone no cadastro
              (ou, se o número estiver certo, confirme).
            </p>
          ) : n.confirmado ? (
            <p className="text-muted-foreground">
              Motivo: {motivos}
              {n.telefoneConfirmadoEm ? ` (${quem ? `por ${quem}` : "pelo escritório"} em ${fmtData(n.telefoneConfirmadoEm)})` : ""}.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Ele ainda não usou o app nem respondeu no WhatsApp, então ninguém garantiu que o telefone é dele.
              {n.soPerguntarNumeroConfirmado
                ? " Enquanto isso, a conferência não manda mensagem pra ele."
                : " Hoje a conferência pergunta a todos, mas você pode deixar este número confirmado."}
            </p>
          )}
        </div>
      </div>
      {podeDecidir && !n.confirmado && (
        <Button
          variant="success"
          disabled={confirmar.isPending}
          onClick={() => confirmar.mutate([motoristaId])}
          data-testid="confirmar-numero"
        >
          {confirmar.isPending ? "Confirmando…" : "Confirmar número"}
        </Button>
      )}
    </Card>
  );
}
