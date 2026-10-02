"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { STATUS_COBRANCA_CLIENTE_LABEL, type StatusCobrancaClienteTipo } from "@ronan/shared-types";
import { Permitido } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { fetchApi, useAuthToken } from "@/lib/client-api";

export type CobrancaDoTitulo = {
  id: string;
  status: StatusCobrancaClienteTipo;
  ambiente: "SANDBOX" | "PRODUCAO";
  asaasPaymentId: string | null;
  valor: string;
  vencimento: string;
  linkFatura: string | null;
  linhaDigitavel: string | null;
  pixCopiaCola: string | null;
  pagoEm: string | null;
  valorRecebido: string | null;
  meio: string | null;
};

/** A conta tem Asaas conectado? Uma consulta só pra lista inteira (cache do react-query). */
export function useAsaasConectado(): boolean {
  const token = useAuthToken();
  const q = useQuery({
    queryKey: ["cobranca-asaas-situacao"],
    enabled: Boolean(token),
    staleTime: 60_000,
    queryFn: () =>
      fetchApi<{ conectada: boolean; ambiente: string | null }>("/admin/cobranca-asaas/situacao", { token: token! }),
  });
  return Boolean(q.data?.conectada);
}

const COR: Record<StatusCobrancaClienteTipo, string> = {
  PENDENTE: "bg-blue-100 text-blue-800",
  VENCIDA: "bg-amber-100 text-amber-800",
  PAGA: "bg-emerald-100 text-emerald-700",
  ESTORNADA: "bg-slate-100 text-slate-700",
  CANCELADA: "bg-slate-100 text-slate-700",
};

async function copiar(texto: string, oQue: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${oQue} copiado.`);
  } catch {
    toast.error("Não consegui copiar. Selecione e copie à mão.", { description: texto });
  }
}

/**
 * O boleto/Pix de um título a receber: gerar, abrir, copiar, cancelar.
 *
 * "Abrir boleto/Pix" é o ÚNICO link que sai pra outra aba: é a página do
 * gateway, onde o cliente escolhe como pagar — não é foto nem documento do
 * sistema (esses abrem no visualizador da própria tela).
 */
export function CobrancaAsaasTitulo({
  tituloId,
  cobranca,
  tituloAberto,
}: {
  tituloId: string;
  cobranca: CobrancaDoTitulo | null;
  /** Título com saldo (ABERTO/PARCIAL)? Só aí faz sentido gerar cobrança nova. */
  tituloAberto: boolean;
}) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const conectado = useAsaasConectado();
  const { confirmar, ConfirmDialog } = useConfirm();
  const [ocupado, setOcupado] = React.useState(false);

  const viva = cobranca && (cobranca.status === "PENDENTE" || cobranca.status === "VENCIDA");
  // Reserva sem id do Asaas = geração interrompida no meio (processo reiniciou).
  // O botão volta: a API retoma a mesma reserva, sem duplicar no Asaas.
  const podeGerar =
    conectado &&
    tituloAberto &&
    (!cobranca || cobranca.status === "CANCELADA" || cobranca.status === "ESTORNADA" || (viva && !cobranca.asaasPaymentId));

  if (!cobranca && !podeGerar) return null;

  async function recarregar() {
    await queryClient.invalidateQueries({ queryKey: ["titulos"] });
    await queryClient.invalidateQueries({ queryKey: ["financeiro-resumo"] });
  }

  async function acao(caminho: string, sucesso: string) {
    if (!token) return;
    setOcupado(true);
    try {
      await fetchApi(caminho, { token, method: "POST" });
      toast.success(sucesso);
      await recarregar();
    } catch (e) {
      toast.error("Não deu certo", { description: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar() {
    if (!cobranca) return;
    const ok = await confirmar({
      variant: "destructive",
      title: "Cancelar este boleto/Pix?",
      description: "A cobrança é apagada no Asaas e o cliente não consegue mais pagar por ela. O título continua em aberto.",
      confirmLabel: "Cancelar cobrança",
      cancelLabel: "Voltar",
    });
    if (ok) await acao(`/admin/cobranca-asaas/cobrancas/${cobranca.id}/cancelar`, "Cobrança cancelada no Asaas.");
  }

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <ConfirmDialog />
      {cobranca && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Boleto/Pix no Asaas:</span>
          <Badge className={`border-transparent ${COR[cobranca.status]}`}>
            {STATUS_COBRANCA_CLIENTE_LABEL[cobranca.status]}
          </Badge>
          {cobranca.ambiente === "SANDBOX" && (
            <Badge className="border-transparent bg-amber-50 text-amber-800">teste</Badge>
          )}
          {cobranca.status === "PAGA" && cobranca.meio && (
            <span className="text-xs text-muted-foreground">por {cobranca.meio.toLowerCase()}</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {viva && cobranca?.linkFatura && (
          <>
            <Button size="sm" variant="outline" asChild>
              <a href={cobranca.linkFatura} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Abrir boleto/Pix
              </a>
            </Button>
            <Button size="sm" variant="outline" onClick={() => void copiar(cobranca.linkFatura!, "Link pra enviar ao cliente")}>
              <Copy className="h-3.5 w-3.5" /> Copiar link pra enviar
            </Button>
          </>
        )}
        {viva && cobranca?.linhaDigitavel && (
          <Button size="sm" variant="outline" onClick={() => void copiar(cobranca.linhaDigitavel!, "Linha digitável")}>
            <Copy className="h-3.5 w-3.5" /> Copiar linha digitável
          </Button>
        )}
        {viva && cobranca?.pixCopiaCola && (
          <Button size="sm" variant="outline" onClick={() => void copiar(cobranca.pixCopiaCola!, "Pix copia-e-cola")}>
            <Copy className="h-3.5 w-3.5" /> Copiar Pix
          </Button>
        )}

        <Permitido chave="financeiro.faturar">
          {podeGerar && (
            <Button
              size="sm"
              disabled={ocupado}
              onClick={() => void acao(`/admin/cobranca-asaas/titulos/${tituloId}/cobranca`, "Boleto/Pix gerado no Asaas.")}
            >
              {ocupado ? "Gerando…" : "Gerar boleto/Pix"}
            </Button>
          )}
          {cobranca?.asaasPaymentId && conectado && cobranca.status !== "CANCELADA" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={ocupado}
              title="Confere no Asaas se o cliente já pagou — útil se o aviso automático não chegou."
              onClick={() =>
                void acao(`/admin/cobranca-asaas/cobrancas/${cobranca.id}/sincronizar`, "Situação conferida no Asaas.")
              }
            >
              <RefreshCw className="h-3.5 w-3.5" /> Atualizar situação
            </Button>
          )}
          {viva && (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-700 hover:bg-red-50 hover:text-red-800"
              disabled={ocupado}
              onClick={() => void cancelar()}
            >
              Cancelar cobrança
            </Button>
          )}
        </Permitido>
      </div>
    </div>
  );
}
