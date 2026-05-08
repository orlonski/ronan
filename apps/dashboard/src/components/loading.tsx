"use client";

import { Loader2 } from "lucide-react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Spinner inline — pra usar dentro de botões, badges, ou qualquer lugar
 * onde queira um indicador discreto.
 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}

/**
 * Card de "Carregando..." padronizado — substitui os placeholders textuais
 * espalhados pelas telas. Aceita um label custom e variant compacto pra
 * caber em listagens densas.
 */
export function LoadingCard({
  label = "Carregando...",
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        "flex items-center justify-center gap-2 text-sm text-muted-foreground",
        compact ? "p-3" : "p-6",
      )}
    >
      <Spinner />
      <span>{label}</span>
    </Card>
  );
}

/**
 * Indicador inline (sem Card) — pra row de tabela ou onde Card é demais.
 */
export function LoadingInline({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/**
 * Barra fina indeterminada no topo do painel — fica visível enquanto QUALQUER
 * query ou mutation do TanStack Query estiver rodando. Cobre o app inteiro
 * sem precisar plugar manualmente em cada tela.
 *
 * Usa `motion-safe` pra respeitar `prefers-reduced-motion`.
 */
export function GlobalLoadingBar() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const ativo = fetching + mutating > 0;

  return (
    <div
      aria-hidden={!ativo}
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity duration-200",
        ativo ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="h-full w-full motion-safe:animate-loading-bar bg-blue-600" />
    </div>
  );
}
