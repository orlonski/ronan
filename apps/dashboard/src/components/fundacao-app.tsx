"use client";
import { useEffect } from "react";

/**
 * Comportamentos de "app" que não cabem em CSS. Não renderiza nada.
 *
 * 1. Falha de chunk pós-deploy: quem estava com o painel aberto quando saiu
 *    versão nova pede um arquivo JS que não existe mais. Recarrega UMA vez
 *    (guarda em sessionStorage contra loop) e a pessoa cai na versão nova.
 *    Não há cache offline de dados aqui, de propósito.
 * 2. Pinça no app instalado (iOS): o Safari ignora `user-scalable=no`, então em
 *    modo standalone o `gesturestart` é cancelado, exceto em mapa e visualizador
 *    de foto. LIMITAÇÃO: o iOS pode ignorar isto também; só se confirma em
 *    aparelho real.
 * 3. `theme-color` acompanha o tema escolhido (os temas são por classe, não por
 *    prefers-color-scheme): a barra do sistema fica da cor do fundo do painel.
 */
const CHAVE_RECARGA = "movatruck:recarga-chunk";
const JANELA_MS = 30_000;
const ERRO_DE_CHUNK =
  /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

function recarregarUmaVez() {
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE_RECARGA) ?? 0);
    if (Date.now() - ultima < JANELA_MS) return; // já recarregou há pouco: não entra em loop
    sessionStorage.setItem(CHAVE_RECARGA, String(Date.now()));
  } catch {
    return; // sem sessionStorage não dá pra garantir o "uma vez"; não arrisca
  }
  window.location.reload();
}

export function FundacaoApp() {
  useEffect(() => {
    const aoErrar = (e: ErrorEvent) => {
      if (ERRO_DE_CHUNK.test(`${e.error?.name ?? ""} ${e.message ?? ""}`)) recarregarUmaVez();
    };
    const aoRejeitar = (e: PromiseRejectionEvent) => {
      const r = e.reason as { name?: string; message?: string } | undefined;
      if (ERRO_DE_CHUNK.test(`${r?.name ?? ""} ${r?.message ?? ""}`)) recarregarUmaVez();
    };
    window.addEventListener("error", aoErrar);
    window.addEventListener("unhandledrejection", aoRejeitar);

    const instalado =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const aoGesto = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(".leaflet-container, .pinch-zoom, [data-pinch]")) return;
      e.preventDefault();
    };
    if (instalado) document.addEventListener("gesturestart", aoGesto, { passive: false } as AddEventListenerOptions);

    const acertarCor = () => {
      const cor = getComputedStyle(document.body).backgroundColor;
      if (!cor || cor === "rgba(0, 0, 0, 0)") return;
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", cor));
    };
    acertarCor();
    const obs = new MutationObserver(acertarCor);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      window.removeEventListener("error", aoErrar);
      window.removeEventListener("unhandledrejection", aoRejeitar);
      document.removeEventListener("gesturestart", aoGesto);
      obs.disconnect();
    };
  }, []);

  return null;
}
