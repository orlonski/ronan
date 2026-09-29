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
