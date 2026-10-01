"use client";

import { useEffect, useState } from "react";

const CAMPOS_DE_TEXTO = /^(text|search|email|tel|url|password|number|date|datetime-local|time|month|week)$/i;

function ehCampoDeTexto(el: Element | null): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  if (h.tagName === "TEXTAREA") return true;
  if (h.tagName === "INPUT") return CAMPOS_DE_TEXTO.test((h as HTMLInputElement).type || "text");
  return h.isContentEditable === true;
}

/**
 * O teclado virtual está aberto? Só faz sentido em aparelho de toque.
 *
 * Dois sinais, porque nenhum sozinho cobre os dois sistemas: (1) foco num campo
 * de texto — o iOS não redimensiona a página, o Android sim (resizes-content),
 * mas nos dois o teclado sobe quando um campo de texto ganha foco; (2)
 * `visualViewport` bem menor que a maior altura vista (teclado aberto por outro
 * caminho). A barra inferior some enquanto isto vale, pra não cobrir o campo.
 */
export function useTecladoAberto(): boolean {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    const toque = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    if (!toque) return;

    let campoFocado = ehCampoDeTexto(document.activeElement);
    let viewportEncolhida = false;
    let alturaMax = Math.max(window.innerHeight, window.visualViewport?.height ?? 0);
    const atualizar = () => setAberto(campoFocado || viewportEncolhida);

    const aoFocar = (e: FocusEvent) => {
      campoFocado = ehCampoDeTexto(e.target as Element);
      atualizar();
    };
    const aoDesfocar = () => {
      // Foco passa de um campo pra outro: espera o próximo focusin antes de mostrar a barra.
      setTimeout(() => {
        campoFocado = ehCampoDeTexto(document.activeElement);
        atualizar();
      }, 60);
    };
    const vv = window.visualViewport;
    let largura = window.innerWidth;
    const aoRedimensionar = () => {
      if (!vv) return;
      // Girar a tela muda a "maior altura": recomeça a comparação.
      if (Math.abs(window.innerWidth - largura) > 50) alturaMax = 0;
      largura = window.innerWidth;
      alturaMax = Math.max(alturaMax, window.innerHeight, vv.height);
      viewportEncolhida = vv.height < alturaMax * 0.75;
      atualizar();
    };

    document.addEventListener("focusin", aoFocar);
    document.addEventListener("focusout", aoDesfocar);
    vv?.addEventListener("resize", aoRedimensionar);
    atualizar();
    return () => {
      document.removeEventListener("focusin", aoFocar);
      document.removeEventListener("focusout", aoDesfocar);
      vv?.removeEventListener("resize", aoRedimensionar);
    };
  }, []);

  return aberto;
}

const SEM_TECLADO = /^(checkbox|radio|button|submit|reset|file|range|color|image|hidden)$/i;

/** O ancestral que de fato rola (no painel é o <main id="conteudo">; nas telas sem painel, a janela). */
function quemRola(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/**
 * Campo focado no CELULAR fica à vista, no meio da área que sobrou acima do teclado.
 *
 * O iOS não redimensiona a janela quando o teclado sobe (só o `visualViewport` encolhe), e o ajuste
 * automático do Safari deixa o campo colado na borda do teclado ou atrás da barra. Aqui o campo vai pro
 * centro da área VISÍVEL (`visualViewport`), esperando ~300ms pro teclado terminar de subir.
 *
 * Regras de convivência:
 *  - só em tela estreita E de toque (no desktop o navegador já resolve e não há teclado virtual);
 *  - janelas/folhas têm o seu próprio ajuste (`useTecladoDaFolha`, rola o miolo): aqui são ignoradas;
 *  - não pula pra campo que já está bem posicionado (folga de 48px) — evita "tremer" a tela;
 *  - o scroll é suave e acontece 1x por foco, nunca em loop;
 *  - a validação guiada (rola até o primeiro campo inválido) e o `autoFocus` continuam como são: se eles
 *    focam um campo, este efeito só confirma que ele está no centro.
 */
export function useFocoVisivelNoCelular() {
  useEffect(() => {
    const estreita = window.matchMedia?.("(max-width: 767px)");
    const toque = window.matchMedia?.("(pointer: coarse)");
    if (!estreita || !toque) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const aoFocar = (e: FocusEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (!alvo || !estreita.matches || !toque.matches) return;
      const tag = alvo.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;
      if (tag === "INPUT" && SEM_TECLADO.test((alvo as HTMLInputElement).type)) return;
      if (alvo.closest('[role="dialog"], [data-folha]')) return;
      clearTimeout(t);
      t = setTimeout(() => {
        if (document.activeElement !== alvo) return;
        const vv = window.visualViewport;
        const topo = vv?.offsetTop ?? 0;
        const altura = vv?.height ?? window.innerHeight;
        const r = alvo.getBoundingClientRect();
        const delta = r.top + r.height / 2 - (topo + altura / 2);
        if (Math.abs(delta) < 48) return;
        const rola = quemRola(alvo);
        (rola ?? window).scrollBy({ top: delta, behavior: "smooth" });
      }, 300);
    };
    document.addEventListener("focusin", aoFocar);
    return () => {
      clearTimeout(t);
      document.removeEventListener("focusin", aoFocar);
    };
  }, []);
}
