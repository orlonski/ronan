"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MOTIVO_RELIGAR_MIN } from "@ronan/shared-types";
import type { EstadoConferenciaMotorista } from "@ronan/shared-types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusToggle } from "@/components/status-toggle";
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
 * Interruptor "Receber a conferência de viagens" (edição do motorista).
 *
 * NÃO faz parte do botão Salvar: é ação própria, grava na hora e avisa por
 * toast. Vale só para este cadastro (esta empresa) — o "Parar" que o motorista
 * toca no WhatsApp vale em todas as empresas dele.
 *
 * Religar quem o PRÓPRIO motorista desligou pede um motivo escrito, num campo
 * inline (sem Modal). Se foi o painel que desligou, religa direto.
 */
export function ConferenciaInterruptor({
  motoristaId,
  inicial,
}: {
  motoristaId: string;
  inicial: ConferenciaDoMotorista;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [estado, setEstado] = useState<ConferenciaDoMotorista>({
    ...inicial,
    receberConferenciaDiaria: inicial.receberConferenciaDiaria !== false,
  });
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [motivo, setMotivo] = useState("");

  const recebe = estado.receberConferenciaDiaria !== false;
  const foiDoMotorista = !recebe && estado.conferenciaDesligadaOrigem !== "PAINEL";
  const motivoOk = motivo.trim().length >= MOTIVO_RELIGAR_MIN;

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
      setMotivo("");
      toast.success(r.receberConferenciaDiaria ? "Conferência religada." : "Conferência desligada.", {
        description: r.receberConferenciaDiaria
          ? "Ele volta a receber a pergunta quando a regra da empresa mandar."
          : "Ele não recebe mais a pergunta de viagens desta empresa.",
      });
      void qc.invalidateQueries();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Não deu pra salvar."),
  });

  function alternar(novo: boolean) {
    if (novo && foiDoMotorista) {
      // Passar por cima do pedido dele: pede o motivo antes.
      setPedindoMotivo(true);
      return;
    }
    salvar.mutate({ recebe: novo });
  }

  const frase = descreverConferencia(estado);

  return (
    <div className="space-y-2 border-t pt-4" data-testid="conferencia-interruptor">
      <div>
        <Label className="text-base">Conferência de viagens no WhatsApp</Label>
        <p className="text-xs text-muted-foreground">
          Quando a regra da empresa indica que ele pode ter esquecido de lançar uma viagem, o sistema pergunta pelo
          WhatsApp. Desligar aqui vale só para o cadastro dele nesta empresa; se ele trabalha em outras, elas não são
          afetadas. Grava na hora, sem precisar salvar o formulário.
        </p>
      </div>
      <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
        <span className="text-sm font-medium text-foreground" id="rotulo-conferencia">
          Receber a conferência de viagens
        </span>
        <StatusToggle
          active={recebe}
          onChange={alternar}
          size="sm"
          label
          disabled={salvar.isPending || pedindoMotivo}
        />
      </div>
      {frase && (
        <p className="text-xs text-amber-700" data-testid="conferencia-estado">
          {frase}
          {estado.conferenciaDesligadaMotivo ? ` Motivo: ${estado.conferenciaDesligadaMotivo}` : ""}
        </p>
      )}
      {pedindoMotivo && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="conferencia-motivo">
          <Label htmlFor="motivo-religar" className="text-sm">
            O motorista pediu pra parar de receber. Por que religar?
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
            <Button
              type="button"
              variant="success"
              size="sm"
              disabled={!motivoOk || salvar.isPending}
              onClick={() => salvar.mutate({ recebe: true, motivo: motivo.trim() })}
            >
              {salvar.isPending ? "Religando…" : "Religar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={salvar.isPending}
              onClick={() => {
                setPedindoMotivo(false);
                setMotivo("");
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
