"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchApi, useAuthToken } from "@/lib/client-api";

/**
 * CANCELAR CONSERTO — o agendado (ou na oficina) que não vai acontecer.
 *
 * Até 24/09/2026 não havia como: o conserto agendado por engano ou desmarcado
 * pela oficina ficava em "Agendado" pra sempre. Não apaga — fica no histórico
 * como cancelado, com o motivo. A revisão ligada volta pra "Precisa de
 * decisão", e o aviso do motorista também (ele recebe "Conserto desmarcado").
 */
export function CancelarConserto({
  manutencao,
  onFechar,
}: {
  manutencao: { id: string; descricao: string; veiculo: { placa: string } | null } | null;
  onFechar: () => void;
}) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  React.useEffect(() => {
    if (!manutencao) return;
    setMotivo("");
    setErro(null);
  }, [manutencao]);

  async function cancelar() {
    if (!token || !manutencao) return;
    if (motivo.trim().length < 3) return setErro("Diga por que o conserto foi cancelado.");
    setErro(null);
    setEnviando(true);
    try {
      await fetchApi(`/admin/manutencao/${manutencao.id}/cancelar`, {
        token,
        method: "POST",
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      toast.success("Conserto cancelado.");
      for (const k of ["manutencoes", "frota-alertas", "planos-manutencao", "problemas-veiculo", "prontuario"]) {
        void queryClient.invalidateQueries({ queryKey: [k] });
      }
      onFechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={manutencao !== null} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar conserto</DialogTitle>
          <DialogDescription>
            {manutencao ? `${manutencao.veiculo?.placa ?? "Caminhão"} · ${manutencao.descricao}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancelar-motivo">Por que foi cancelado?</Label>
          <Textarea
            id="cancelar-motivo"
            rows={3}
            maxLength={300}
            placeholder="Ex.: a oficina desmarcou; agendei no caminhão errado"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Fica no histórico do caminhão. Se era uma revisão programada, ela volta pra Precisa de
            decisão; se veio de um aviso do motorista, o aviso volta também e ele fica sabendo.
          </p>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>
            Voltar
          </Button>
          <Button variant="warning" onClick={() => void cancelar()} disabled={enviando}>
            Cancelar conserto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
