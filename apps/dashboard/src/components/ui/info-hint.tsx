"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ícone "?" discreto que, ao passar o mouse (ou focar via teclado), mostra uma
 * explicação curta e simples do que aquele número significa. Portal do Radix
 * evita clipping dentro dos cards. Auto-contido (traz o próprio Provider), então
 * é só dropar onde precisar.
 */
export function InfoHint({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip.Provider delayDuration={120}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-label="O que isso significa?"
            // Dentro de cards que são <Link>: não deixa o clique no ícone navegar.
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className={cn(
              "inline-flex shrink-0 cursor-help text-muted-foreground/50 transition-colors hover:text-foreground focus:outline-none focus-visible:text-foreground",
              className,
            )}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 max-w-[16rem] rounded-md bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-50 shadow-lg"
          >
            {text}
            <Tooltip.Arrow className="fill-slate-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
