"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";

type Mensagem = {
  id: string;
  autor: "ADMIN" | "MOTORISTA";
  autorNome: string;
  texto: string;
  acao: string | null;
  criadoEm: string;
};

const ACAO_LABEL: Record<string, string> = {
  MARCOU_DIVERGENTE: "Marcou como divergente",
  CORRIGIU_KM: "Respondeu o km",
  ESCOLHEU_ROTA: "Registrou a estrada",
  INFORMOU_PEDAGIO: "Informou o pedágio",
  ENVIOU_FOTO: "Enviou foto nova",
  // Material que não gera documento: a viagem entra aprovada por regra.
  DISPENSOU_CONFERENCIA: "Sem conferência (material)",
  // As duas abaixo o backend já gravava, e não estavam aqui — mensagem com
  // `acao` fora desta lista simplesmente não renderiza selo. A conferência
  // automática vinha aparecendo sem nenhum.
  CONFERIU: "Conferido pela IA",
  CORRIGIU_TICKET: "Corrigiu o ticket",
};

/**
 * Chat da viagem (admin <-> motorista). Mostra a conversa inteira com autor,
 * data/hora e um selo quando a mensagem veio de uma ação (marcou divergente,
 * corrigiu km, etc). O admin escreve pela caixa embaixo.
 */
export function ConversaViagemCard({ viagemId }: { viagemId: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");

  const mensagens = useQuery({
    queryKey: ["viagem-mensagens", viagemId],
    enabled: !!token,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    queryFn: () =>
      fetchApi<Mensagem[]>(`/admin/viagens/${viagemId}/mensagens`, { token }),
  });

  const enviar = useMutation({
    mutationFn: (t: string) =>
      fetchApi<Mensagem[]>(`/admin/viagens/${viagemId}/mensagens`, {
        method: "POST",
        body: JSON.stringify({ texto: t }),
        token,
      }),
    onSuccess: (lista) => {
      qc.setQueryData(["viagem-mensagens", viagemId], lista);
      setTexto("");
    },
  });

  const lista = mensagens.data ?? [];

  function submit() {
    const t = texto.trim();
    if (t.length === 0 || enviar.isPending) return;
    enviar.mutate(t);
  }

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="mb-3 flex items-center gap-2 text-base font-medium">
        <MessageSquare className="h-4 w-4" /> Conversa
      </h3>

      <div className="mb-3 max-h-96 space-y-2 overflow-y-auto pr-1">
        {mensagens.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma mensagem ainda. Escreva pro motorista abaixo.
          </p>
        ) : (
          lista.map((m) => {
            const ehAdmin = m.autor === "ADMIN";
            return (
              <div
                key={m.id}
                className={`flex ${ehAdmin ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    ehAdmin
                      ? "rounded-br-sm bg-primary/10 text-foreground"
                      : "rounded-bl-sm bg-muted text-foreground"
                  }`}
                >
                  <div className="mb-0.5 flex items-baseline gap-2">
                    <span className="text-xs font-semibold">{m.autorNome}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {fmtDataHoraBR(m.criadoEm)}
                    </span>
                  </div>
                  {m.acao && ACAO_LABEL[m.acao] && (
                    <span className="mb-1 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      {ACAO_LABEL[m.acao]}
                    </span>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Escrever pro motorista…"
          rows={2}
          maxLength={1000}
          className="min-h-[44px] flex-1 resize-none"
        />
        <Button
          onClick={submit}
          disabled={texto.trim().length === 0 || enviar.isPending}
          size="icon"
          className="h-11 w-11 shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      {enviar.isError && (
        <p className="mt-1 text-xs text-destructive">
          Não foi possível enviar. Tente de novo.
        </p>
      )}
    </Card>
  );
}
