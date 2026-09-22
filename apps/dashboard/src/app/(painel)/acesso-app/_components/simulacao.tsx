"use client";

import { useState } from "react";
import { CAPACIDADE_POR_CHAVE, type CapacidadeApp } from "@ronan/shared-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Simulacao } from "./tipos";

const rotulo = (c: string) => CAPACIDADE_POR_CHAVE[c as CapacidadeApp]?.label ?? c;

/**
 * "37 pessoas mudam: 12 perdem Conversas" — ANTES de salvar.
 *
 * ⚠️ É o que sustenta a regra do dono: ninguém perde nada no celular sem quem
 * decide ver antes, com nome, quem perde o quê. A cor do botão segue o
 * semáforo: amarelo se alguém perde, verde se só ganham.
 */
export function ConfirmarMudanca({
  titulo,
  simulacao,
  onConfirmar,
  onCancelar,
}: {
  titulo: string;
  simulacao: Simulacao;
  onConfirmar: () => Promise<void>;
  onCancelar: () => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const perdem = simulacao.mudam.filter((m) => m.perdeu.length > 0).length;
  const ganham = simulacao.mudam.filter((m) => m.ganhou.length > 0).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancelar()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        {simulacao.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ninguém muda: o app de todo mundo continua exatamente igual.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              <strong>{simulacao.total}</strong> pessoa(s) mudam
              {perdem > 0 && (
                <>
                  {" "}
                  — <strong className="text-amber-700">{perdem} perdem</strong> alguma coisa no
                  celular
                </>
              )}
              {ganham > 0 && <> · {ganham} ganham</>}.
            </p>
            {perdem > 0 && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Quem estiver sem sinal ainda vê o que perdeu até sincronizar. O que lançar
                nesse meio-tempo chega pra conferência — não se perde.
              </p>
            )}
            <div className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {simulacao.mudam.map((m) => (
                <div key={m.cpf} className="px-3 py-2 text-sm">
                  <p className="font-medium">{m.nome}</p>
                  {m.perdeu.length > 0 && (
                    <p className="text-xs text-amber-800">Perde: {m.perdeu.map(rotulo).join(", ")}</p>
                  )}
                  {m.ganhou.length > 0 && (
                    <p className="text-xs text-emerald-700">Ganha: {m.ganhou.map(rotulo).join(", ")}</p>
                  )}
                </div>
              ))}
            </div>
            {simulacao.total > simulacao.mudam.length && (
              <p className="text-xs text-muted-foreground">
                Mostrando {simulacao.mudam.length} de {simulacao.total}.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancelar} disabled={salvando}>
            Voltar sem salvar
          </Button>
          <Button
            variant={simulacao.total === 0 ? "default" : perdem > 0 ? "warning" : "success"}
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              try {
                await onConfirmar();
              } finally {
                setSalvando(false);
              }
            }}
          >
            {salvando
              ? "Aplicando…"
              : simulacao.total === 0
                ? "Salvar"
                : `Aplicar pra ${simulacao.total} pessoa(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
