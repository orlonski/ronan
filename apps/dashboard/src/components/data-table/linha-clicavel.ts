"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/** Tudo que tem ação própria: clicar aí NUNCA navega pela linha/card. */
const INTERATIVO =
  'a,button,input,select,textarea,label,summary,[role="button"],[role="switch"],[role="checkbox"],[role="menuitem"],[role="link"],[data-no-row-click]';

/**
 * Deixa a linha da tabela / o card inteiro clicável, sem tirar o <a> real do
 * nome (que continua servindo teclado, Ctrl/Cmd+clique e botão do meio).
 * Cliques em qualquer controle interno (botão, switch, checkbox, link) e em
 * conteúdo de portal (diálogos) são ignorados; selecionar texto também.
 */
export function useLinhaClicavel() {
  const router = useRouter();
  return React.useCallback(
    (href: string | undefined) => {
      if (!href) return {};
      const deveIgnorar = (e: React.MouseEvent<HTMLElement>) => {
        const alvo = e.target as HTMLElement;
        // React propaga eventos de portal (Dialog/Sheet) pela árvore de componentes.
        if (!e.currentTarget.contains(alvo)) return true;
        const interativo = alvo.closest(INTERATIVO);
        if (interativo && e.currentTarget.contains(interativo)) return true;
        return !!window.getSelection()?.toString();
      };
      return {
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          if (e.defaultPrevented || e.button !== 0 || deveIgnorar(e)) return;
          if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
          else if (e.shiftKey) window.open(href, "_blank");
          else router.push(href as Parameters<typeof router.push>[0]);
        },
        onAuxClick: (e: React.MouseEvent<HTMLElement>) => {
          if (e.button !== 1 || deveIgnorar(e)) return;
          e.preventDefault();
          window.open(href, "_blank", "noopener");
        },
        "data-linha-clicavel": "",
      } as const;
    },
    [router],
  );
}

/** Classes de hover/cursor da linha ou do card clicável. */
export const LINHA_CLICAVEL_CLASSES = "cursor-pointer";
