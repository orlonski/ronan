"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * FOLHA DE BAIXO — o jeito de uma janela (Dialog/Sheet) se comportar NO CELULAR (< 768px).
 * Do `md` pra cima nada aqui vale: as classes são todas `max-md:` e o miolo vira `display: contents`.
 *
 * Critério (Leva 1, fatia 3):
 *  - "baixo"   (padrão)  qualquer janela com campo, lista, tabela, mapa ou mais que texto+2 botões:
 *                        sobe do rodapé, largura total, cantos de cima arredondados, cabeçalho e rodapé de
 *                        ações FIXOS e só o miolo rola.
 *  - "centrado"          só a CONFIRMAÇÃO curta (título + 1-2 linhas + 2 botões, sem campo): continua um
 *                        cartão no meio da tela, com margem dos lados. É o padrão do iOS pra "Excluir X?"
 *                        e não cobre a tela por causa de duas linhas.
 *
 * O que muda de modo pro outro vem do atributo `data-folha` no conteúdo — `DialogHeader`/`DialogFooter`
 * leem via `group-data-[folha=baixo]/folha:` — então o primitivo cobre os usos sem cada um mexer.
 */
export type ModoFolha = "baixo" | "centrado";

/** Classes do CONTEÚDO (a folha em si). `!` nas dimensões: os usos trazem `max-w-*`, `w-[..]`, `max-h-[..dvh]` que brigariam. */
export function classesFolha(modo: ModoFolha, lado: "dialog" | "sheet"): string {
  if (modo === "centrado") {
    return "group/folha max-md:!w-[calc(100%-2rem)] max-md:!max-w-md max-md:!rounded-xl";
  }
  return cn(
    "group/folha",
    // ancora embaixo, largura total, sem o centro/gaveta do desktop
    "max-md:!inset-x-0 max-md:!bottom-[var(--folha-teclado,0px)] max-md:!left-0 max-md:!right-0 max-md:!top-auto",
    "max-md:!translate-x-0 max-md:!translate-y-0 max-md:!w-full max-md:!max-w-none",
    // altura: em dvh, com folga do topo e do entalhe; com o teclado do iPhone, a área visível
    "max-md:!max-h-[calc(var(--folha-altura,100dvh)-env(safe-area-inset-top)-0.75rem)]",
    "max-md:!flex max-md:!flex-col max-md:!gap-0 max-md:!overflow-hidden max-md:!p-0",
    "max-md:!rounded-b-none max-md:!rounded-t-2xl max-md:!border-x-0 max-md:!border-b-0",
    "max-md:data-[state=open]:!slide-in-from-bottom max-md:data-[state=closed]:!slide-out-to-bottom",
    "max-md:data-[state=open]:!duration-300 max-md:data-[state=open]:!fade-in-100 max-md:data-[state=closed]:!fade-out-100",
    lado === "sheet" &&
      "max-md:data-[state=open]:!slide-in-from-right-0 max-md:data-[state=closed]:!slide-out-to-right-0",
  );
}

/** Miolo que rola (só no celular). No desktop é `contents`: os filhos ficam como filhos diretos do conteúdo, como sempre foram. */
export const CORPO_FOLHA =
  "max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:gap-4 max-md:overflow-y-auto max-md:overscroll-contain max-md:px-4 max-md:pb-4 md:contents";

/** Cabeçalho da folha: gruda no topo do miolo. `-mx-4` sangra o padding do miolo pra o fundo cobrir a largura toda. */
export const CABECALHO_FOLHA =
  "group-data-[folha=baixo]/folha:max-md:sticky group-data-[folha=baixo]/folha:max-md:top-0 group-data-[folha=baixo]/folha:max-md:z-10 group-data-[folha=baixo]/folha:max-md:-mx-4 group-data-[folha=baixo]/folha:max-md:bg-background group-data-[folha=baixo]/folha:max-md:px-4 group-data-[folha=baixo]/folha:max-md:pb-2 group-data-[folha=baixo]/folha:max-md:pr-14 group-data-[folha=baixo]/folha:max-md:text-left";

/**
 * Rodapé de ações: gruda embaixo, com linha em cima e respiro do gesto do iPhone.
 * `bottom-[-1rem]` cancela o `pb-4` do miolo (o sticky respeita o padding do scroller e deixaria uma fresta com o conteúdo aparecendo por baixo);
 * `!-mb-4` vence o `space-y-*` de quem põe o rodapé dentro de um <form>.
 */
export const RODAPE_FOLHA =
  "group-data-[folha=baixo]/folha:max-md:sticky group-data-[folha=baixo]/folha:max-md:bottom-[-1rem] group-data-[folha=baixo]/folha:max-md:z-10 group-data-[folha=baixo]/folha:max-md:-mx-4 group-data-[folha=baixo]/folha:max-md:!-mb-4 group-data-[folha=baixo]/folha:max-md:border-t group-data-[folha=baixo]/folha:max-md:bg-background group-data-[folha=baixo]/folha:max-md:px-4 group-data-[folha=baixo]/folha:max-md:pt-3 group-data-[folha=baixo]/folha:max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]";

/** Fechar com alvo de 44px no celular; no desktop, o mesmo de sempre. */
export const FECHAR_FOLHA = "max-md:z-20 max-md:right-1 max-md:top-1 max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center max-md:rounded-full max-md:opacity-100";

/**
 * Alça de arrasto. Só o toque na alça arrasta (o miolo rola em paz, nunca fecha ao rolar). Passou de 90px
 * pra baixo, fecha clicando no botão Fechar (assim o `onOpenChange` de quem usa a janela roda normal).
 */
export function AlcaFolha({ conteudo, fechar }: { conteudo: React.RefObject<HTMLElement | null>; fechar: React.RefObject<HTMLButtonElement | null> }) {
  const inicio = React.useRef<number | null>(null);
  const dy = React.useRef(0);
  const aplicar = (px: number, animar: boolean) => {
    const el = conteudo.current;
    if (!el) return;
    el.style.transition = animar ? "transform 200ms ease-out" : "none";
    el.style.transform = px > 0 ? `translateY(${px}px)` : "";
  };
  return (
    <div
      data-alca-folha
      className="flex shrink-0 cursor-grab touch-none justify-center pb-1 pt-2 group-data-[folha=centrado]/folha:hidden md:hidden"
      onPointerDown={(e) => {
        inicio.current = e.clientY;
        dy.current = 0;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (inicio.current == null) return;
        dy.current = Math.max(0, e.clientY - inicio.current);
        aplicar(dy.current, false);
      }}
      onPointerUp={() => {
        const passou = dy.current > 90;
        inicio.current = null;
        if (passou) fechar.current?.click();
        else aplicar(0, true);
        dy.current = 0;
      }}
      onPointerCancel={() => {
        inicio.current = null;
        dy.current = 0;
        aplicar(0, true);
      }}
    >
      <span className="h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
    </div>
  );
}

/**
 * Teclado do celular. O iOS NÃO redimensiona a janela (o `interactive-widget` do meta viewport é ignorado lá):
 * uma folha ancorada embaixo ficaria POR BAIXO do teclado. Aqui a folha sobe pela altura do teclado
 * (`--folha-teclado`) e a altura máxima passa a ser a da área visível (`--folha-altura`). No Android o
 * `resizes-content` já encolhe a janela e os dois valores ficam em 0/altura da janela — não atrapalha.

 * `el` é o nó em ESTADO (não ref): o conteúdo só existe enquanto a janela está aberta, e um efeito com ref leria `null` na montagem.
 * Também traz o campo focado pro meio da folha (o miolo rola) depois que o teclado terminou de subir.
 */
export function useTecladoDaFolha(el: HTMLElement | null, ativo: boolean) {
  React.useEffect(() => {
    if (!ativo || !el) return;
    const mq = window.matchMedia("(max-width: 767px)");
    const vv = window.visualViewport;
    const medir = () => {
      if (!mq.matches || !vv) {
        el.style.removeProperty("--folha-teclado");
        el.style.removeProperty("--folha-altura");
        return;
      }
      const teclado = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      el.style.setProperty("--folha-teclado", `${teclado}px`);
      el.style.setProperty("--folha-altura", `${Math.round(vv.height)}px`);
    };
    const campo = /^(INPUT|TEXTAREA|SELECT)$/;
    let t: ReturnType<typeof setTimeout> | undefined;
    const aoFocar = (e: FocusEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (!mq.matches || !alvo || !campo.test(alvo.tagName)) return;
      clearTimeout(t);
      // o teclado leva ~250ms pra subir; medir e rolar depois evita rolar pro lugar errado
      t = setTimeout(() => {
        medir();
        alvo.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 300);
    };
    medir();
    vv?.addEventListener("resize", medir);
    vv?.addEventListener("scroll", medir);
    el.addEventListener("focusin", aoFocar);
    return () => {
      clearTimeout(t);
      vv?.removeEventListener("resize", medir);
      vv?.removeEventListener("scroll", medir);
      el.removeEventListener("focusin", aoFocar);
    };
  }, [el, ativo]);
}

/** Junta a ref de fora (forwardRef) com a de dentro. */
export function juntarRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (valor: T | null) => {
    for (const r of refs) {
      if (typeof r === "function") r(valor);
      else if (r) (r as React.MutableRefObject<T | null>).current = valor;
    }
  };
}
