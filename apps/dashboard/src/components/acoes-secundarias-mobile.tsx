"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Item = { el: HTMLElement; rotulo: string; desabilitado: boolean; icone?: string; perigo: boolean };

/**
 * Ações secundárias de um cartão de lista: no desktop (md+) ficam como sempre (uma faixa de ícones);
 * no celular (< 768px) somem da faixa e viram um menu "⋯" de 44px.
 *
 * A ação principal (ex.: Editar) fica na faixa também no celular: marque o elemento com `data-mobile-visivel`.
 *
 * Os botões NÃO são reescritos: os mesmos componentes (com seus gates de permissão, diálogos e
 * confirmações) seguem montados dentro de um contêiner escondido no celular, e cada item do menu
 * apenas aciona o botão real (`click()`). O rótulo do item é o `title`/`aria-label` do botão,
 * então ação nova aparece no menu sozinha, e botão escondido por permissão simplesmente não vira item.
 */
export function AcoesSecundariasMobile({
  children,
  rotuloMenu = "Mais ações",
}: {
  children: React.ReactNode;
  rotuloMenu?: string;
}) {
  const caixa = React.useRef<HTMLDivElement>(null);
  const [itens, setItens] = React.useState<Item[]>([]);

  function ler() {
    const alvos = Array.from(caixa.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? []).filter(
      // link que só embrulha um botão: vale o botão
      (el) => !(el.tagName === "A" && el.querySelector("button")) && !el.closest("[data-mobile-visivel]"),
    );
    setItens(
      alvos.map((el) => ({
        el,
        rotulo: (el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent || "Ação").trim(),
        desabilitado: el.hasAttribute("disabled"),
        icone: el.querySelector("svg")?.outerHTML,
        perigo: /\bbg-destructive\b|\btext-destructive\b/.test(el.className),
      })),
    );
  }

  return (
    <>
      {/* `contents`: no desktop os botões seguem como filhos diretos da faixa. No celular, tudo some
          menos o que a tela marcou com `data-mobile-visivel` (a ação principal). */}
      <div ref={caixa} className="contents max-md:[&>:not([data-mobile-visivel])]:hidden">
        {children}
      </div>
      <div className="md:hidden" data-no-row-click>
        <DropdownMenu modal={false} onOpenChange={(aberto) => aberto && ler()}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={rotuloMenu} title={rotuloMenu}>
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[14rem]">
            {itens.length === 0 && (
              <div className="px-2 py-2 text-sm text-muted-foreground">Nenhuma ação disponível.</div>
            )}
            {itens.map((it, i) => (
              <DropdownMenuItem
                key={i}
                disabled={it.desabilitado}
                className={`max-md:!min-h-[44px] ${it.perigo ? "text-destructive focus:text-destructive" : ""}`}
                // depois do menu fechar: abrir um diálogo no mesmo instante disputa o foco com o menu
                onSelect={() => setTimeout(() => it.el.click(), 50)}
              >
                {it.icone && (
                  <span
                    aria-hidden
                    className="shrink-0 [&>svg]:h-4 [&>svg]:w-4"
                    dangerouslySetInnerHTML={{ __html: it.icone }}
                  />
                )}
                <span>{it.rotulo}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
