"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusToggle } from "@/components/status-toggle";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Modulo = {
  chave: string;
  nome: string;
  pitch: string;
  nucleo?: boolean;
  medido?: boolean;
  adicional?: boolean;
  contratado: boolean;
  vigente: boolean;
  vigenteAte: string | null;
  ligadoPor: { id: string; nome: string } | null;
};

/**
 * O que cada empresa contratou.
 *
 * Mora na tela da plataforma porque o dono da empresa não escolhe o próprio
 * contrato — a mesma régua do teto de permissões e do preço.
 *
 * O backend já devolvia tudo isto ("é o que a tela de Empresas mostra", diz o
 * comentário do serviço) e a tela nunca tinha sido feita: os módulos existiam,
 * gateavam telas de verdade, e não havia como ligar nenhum.
 */
export function ModulosDialog({
  conta,
  aberto,
  onFechar,
}: {
  conta: { id: string; nome: string } | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [salvando, setSalvando] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["modulos", conta?.id],
    enabled: Boolean(token && conta && aberto),
    queryFn: () =>
      fetchApi<Modulo[]>(`/admin/contas/${conta!.id}/modulos`, { token: token! }),
  });

  async function alternar(m: Modulo) {
    if (!token || !conta) return;
    setSalvando(m.chave);
    try {
      await fetchApi(`/admin/contas/${conta.id}/modulos/${m.chave}`, {
        token,
        method: "PUT",
        body: JSON.stringify({ ativo: !m.contratado }),
      });
      await qc.invalidateQueries({ queryKey: ["modulos", conta.id] });
      toast.success(`${m.nome} ${m.contratado ? "desligado" : "ligado"} para ${conta.nome}.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Módulos de {conta?.nome}</DialogTitle>
          <DialogDescription>
            O que esta empresa contratou. Módulo desligado some do menu dela, e quem
            chegar pela URL vê “não está ativo na sua empresa” — texto diferente de
            “acesso restrito”, porque aqui quem resolve é a gente, não o administrador
            dela.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        <div className="space-y-2">
          {(data ?? []).map((m) => (
            <div
              key={m.chave}
              className={`flex items-start justify-between gap-4 rounded-lg border p-3 ${
                m.vigente ? "border-emerald-300 bg-emerald-50/40" : "border-border"
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.nome}</span>
                  {m.nucleo && (
                    <Badge className="border-transparent bg-slate-100 text-slate-600">
                      <Lock className="mr-1 h-3 w-3" />
                      Núcleo
                    </Badge>
                  )}
                  {m.adicional && (
                    <Badge className="border-transparent bg-amber-100 text-amber-800">
                      <Tag className="mr-1 h-3 w-3" />
                      Adicional
                    </Badge>
                  )}
                  {/* Medido = gasta dinheiro da plataforma por uso. É a
                      diferença entre "vendemos à parte" e "nós pagamos a conta". */}
                  {m.medido && (
                    <Badge className="border-transparent bg-purple-100 text-purple-800">
                      <Sparkles className="mr-1 h-3 w-3" />
                      Custa por uso
                    </Badge>
                  )}
                  {m.contratado && !m.vigente && (
                    <Badge className="border-transparent bg-red-100 text-red-700">
                      Fora da vigência
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{m.pitch}</p>
                {m.ligadoPor && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Por {m.ligadoPor.nome}
                    {m.vigenteAte
                      ? ` · até ${m.vigenteAte.slice(0, 10).split("-").reverse().join("/")}`
                      : ""}
                  </p>
                )}
              </div>

              {/* O núcleo não desliga: seria vender um sistema de viagens que
                  não registra viagem. Pra suspender a empresa existe o estado
                  da conta. */}
              {m.nucleo ? (
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  sempre ligado
                </span>
              ) : (
                <StatusToggle
                  active={m.contratado}
                  onChange={() => void alternar(m)}
                  size="sm"
                  disabled={salvando === m.chave}
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
