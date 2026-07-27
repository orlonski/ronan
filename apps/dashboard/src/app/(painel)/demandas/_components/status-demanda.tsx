"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Vocabulário de status da tela. O banco fala em EXECUTANDO/CONCLUIDA; aqui a
 * gente fala como a pessoa pensa ("Trabalhando", "Pronta"), sem inventar
 * estado que não existe.
 */
export const STATUS_DEMANDA: Record<string, { label: string; classe: string; dica: string }> = {
  PENDENTE: {
    label: "Na fila",
    classe: "border-slate-300 bg-slate-100 text-slate-700",
    dica: "Aguardando o agente pegar. Ele confere a fila a cada 5 segundos.",
  },
  EXECUTANDO: {
    label: "Trabalhando",
    classe: "border-blue-300 bg-blue-100 text-blue-800",
    dica: "O agente está com essa demanda agora.",
  },
  CONCLUIDA: {
    label: "Pronta",
    classe: "border-emerald-300 bg-emerald-100 text-emerald-800",
    dica: "Terminou sem erro. Leia o relato pra conferir o que foi feito.",
  },
  FALHOU: {
    label: "Falhou",
    classe: "border-rose-300 bg-rose-100 text-rose-800",
    dica: "O agente não concluiu. O relato explica o motivo.",
  },
  EXCEDEU_LIMITE: {
    label: "Passou do limite",
    classe: "border-amber-300 bg-amber-100 text-amber-900",
    dica: "Bateu o teto de tempo ou o limite de uso da conta. Nada foi publicado.",
  },
};

export function StatusDemanda({ status }: { status: string }) {
  const s = STATUS_DEMANDA[status];
  if (!s) return <Badge>{status}</Badge>;
  return (
    <Badge className={s.classe} title={s.dica}>
      {s.label}
    </Badge>
  );
}

/** Duração amigável: "1m 20s" em vez de 80000. */
export function duracao(ms: number | null): string {
  if (ms == null) return "—";
  const seg = Math.round(ms / 1000);
  if (seg < 60) return `${seg}s`;
  return `${Math.floor(seg / 60)}m ${String(seg % 60).padStart(2, "0")}s`;
}

/** Quanto tempo faz. Usado no "agente visto há X" e no cronômetro do ao vivo. */
export function desde(iso: string | Date | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
