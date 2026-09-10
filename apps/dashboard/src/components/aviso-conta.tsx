"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { usePermissoes } from "@/lib/permissoes";

/**
 * O estado da empresa, dito em voz alta e o tempo todo.
 *
 * Duas situações, com pesos diferentes:
 *
 * - **teste correndo** — conta os dias que faltam. Fica discreto no começo e só
 *   vira alerta na última semana, porque um aviso que grita desde o dia 1 é um
 *   aviso que ninguém lê no dia 13.
 * - **somente leitura** — o teste acabou. Aqui é âmbar e permanente: sem isso a
 *   única pista que o cliente teria seria o erro ao tentar salvar alguma coisa,
 *   e ele concluiria que o sistema quebrou.
 */
export function AvisoConta() {
  const { estadoConta } = usePermissoes();
  if (!estadoConta) return null;

  const { podeEscrever, emTeste, diasRestantes, motivo } = estadoConta;

  if (!podeEscrever) {
    return (
      <div
        role="status"
        className="flex items-center gap-x-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">
          {motivo ?? "Esta empresa está em modo somente leitura."}
        </p>
      </div>
    );
  }

  if (!emTeste || diasRestantes === null) return null;

  // Na última semana o aviso muda de tom. Antes disso é informação; a partir
  // daí é algo que exige uma decisão.
  const urgente = diasRestantes <= 7;
  const texto =
    diasRestantes <= 0
      ? "Seu período de teste termina hoje."
      : diasRestantes === 1
        ? "Falta 1 dia do seu período de teste."
        : `Faltam ${diasRestantes} dias do seu período de teste.`;

  return (
    <div
      role="status"
      className={
        urgente
          ? "flex items-center gap-x-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          : "flex items-center gap-x-3 border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
      }
    >
      <Clock className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">{texto}</p>
    </div>
  );
}
