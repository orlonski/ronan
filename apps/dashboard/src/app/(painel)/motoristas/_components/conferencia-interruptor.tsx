"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MOTIVO_RELIGAR_MIN } from "@ronan/shared-types";
import type { EstadoConferenciaMotorista } from "@ronan/shared-types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken } from "@/lib/client-api";

/** O que a API guarda sobre a conferência do vínculo (ficha, lista e PATCH devolvem o mesmo). */
export type ConferenciaDoMotorista = {
  receberConferenciaDiaria?: boolean | null;
  conferenciaDesligadaEm?: string | null;
  conferenciaDesligadaOrigem?: "MOTORISTA" | "PAINEL" | null;
  conferenciaDesligadaPor?: { id: string; nome: string } | null;
  conferenciaDesligadaMotivo?: string | null;
};

const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * A frase do estado, a mesma na ficha e na edição. `null` = ligada (nada a
 * dizer). Linha antiga desligada sem origem foi o motorista: era o único
 * caminho que desligava.
 */
export function descreverConferencia(c: ConferenciaDoMotorista): string | null {
  if (c.receberConferenciaDiaria !== false) return null;
  if (c.conferenciaDesligadaOrigem === "PAINEL") {
    const quem = c.conferenciaDesligadaPor?.nome ?? "um usuário do painel";
    return `Desligada pelo painel por ${quem}${c.conferenciaDesligadaEm ? ` em ${fmtData(c.conferenciaDesligadaEm)}` : ""}.`;
  }
  return `Desligada pelo motorista${c.conferenciaDesligadaEm ? ` em ${fmtData(c.conferenciaDesligadaEm)}` : ""}.`;
}

/**
 * A conferência de viagens por WhatsApp, como um item da lista de acessos do
 * app (`AcessosDoApp`). Não é mais uma seção à parte.
 *
 * Grava na hora (não faz parte de nenhum botão Salvar) e vale só para este
 * cadastro (esta empresa) — o "Parar" que o motorista toca no WhatsApp vale em
 * todas as empresas dele.
 *
 * Religar quem o PRÓPRIO motorista desligou pede um motivo escrito, num campo
 * inline (sem Modal), e só nesse momento. Se foi o painel que desligou, religa
 * direto.
 */
export function useConferenciaMotorista(motoristaId: string, inicial: ConferenciaDoMotorista) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [estado, setEstado] = useState<ConferenciaDoMotorista>({
    ...inicial,
    receberConferenciaDiaria: inicial.receberConferenciaDiaria !== false,
  });
  const [pedindoMotivo, setPedindoMotivo] = useState(false);

  const recebe = estado.receberConferenciaDiaria !== false;
  const foiDoMotorista = !recebe && estado.conferenciaDesligadaOrigem !== "PAINEL";

  const salvar = useMutation({
    mutationFn: (corpo: { recebe: boolean; motivo?: string }) =>
      fetchApi<EstadoConferenciaMotorista>(`/admin/conferencia-diaria/motoristas/${motoristaId}/recebe`, {
        method: "PATCH",
        token,
        body: JSON.stringify(corpo),
      }),
    onSuccess: (r) => {
      setEstado(r);
      setPedindoMotivo(false);
      toast.success(r.receberConferenciaDiaria ? "Conferência de viagens: ligado" : "Conferência de viagens: desligado", {
        duration: 2000,
      });
      void qc.invalidateQueries();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não deu pra salvar. Ficou como estava."),
  });

  /** `true` = aplicou; `false` = precisa do motivo antes (o campo abre sozinho). */
  async function definir(novo: boolean): Promise<boolean> {
    if (novo === recebe) return true;
    if (novo && foiDoMotorista) {
      // Passar por cima do pedido dele: pede o motivo antes.
      setPedindoMotivo(true);
      return false;
    }
    try {
      await salvar.mutateAsync({ recebe: novo });
      return true;
    } catch {
      return false;
    }
  }

  return {
    recebe,
    definir,
    ocupado: salvar.isPending,
    pedindoMotivo,
    cancelarMotivo: () => setPedindoMotivo(false),
    religarComMotivo: (motivo: string) => salvar.mutate({ recebe: true, motivo }),
    frase: descreverConferencia(estado),
    motivoDoPainel: estado.conferenciaDesligadaMotivo ?? null,
  };
}

/** O campo de motivo que aparece SÓ ao religar quem o próprio motorista desligou. */
export function ConferenciaMotivoInline({
  ocupado,
  onReligar,
  onCancelar,
}: {
  ocupado: boolean;
  onReligar: (motivo: string) => void;
  onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const motivoOk = motivo.trim().length >= MOTIVO_RELIGAR_MIN;
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="conferencia-motivo">
      <Label htmlFor="motivo-religar" className="text-sm">
        O motorista pediu pra parar de receber a conferência. Por que religar?
      </Label>
      <Input
        id="motivo-religar"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Ex.: a pedido do motorista"
        maxLength={500}
        autoFocus
      />
      <p className="text-xs text-muted-foreground">Mínimo de {MOTIVO_RELIGAR_MIN} letras. Fica registrado com o seu nome.</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={onCancelar}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="success"
          size="sm"
          disabled={!motivoOk || ocupado}
          onClick={() => onReligar(motivo.trim())}
        >
          {ocupado ? "Religando…" : "Religar conferência"}
        </Button>
      </div>
    </div>
  );
}
