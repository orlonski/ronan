"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { LogoConta } from "@/components/logo-conta";
import { ANCORAS_DO_MENU } from "@/lib/menu";
import { alternarGaveta, definirGaveta, useGavetaAberta } from "@/lib/menu-lateral";

export const ID_MENU_LATERAL = "menu-lateral";

/**
 * Hambúrguer do cabeçalho: abre a gaveta do menu na faixa 768–1535px com o menu
 * recolhido. Escondido por CSS (`.menu-botao`) em qualquer outro caso — 1536px+, menu
 * fixo e celular — então não ocupa nem um pixel lá.
 *
 * Âncora do passo a passo: com a gaveta fechada os itens do menu medem 0x0/escondidos,
 * e este botão serve de alvo no lugar deles (o `medirAlvo` usa o primeiro da lista que
 * estiver na tela) — mesmo truque do botão "Mais" da barra inferior do celular.
 */
export function BotaoMenu() {
  const aberta = useGavetaAberta();
  return (
    // Com o menu recolhido a logo da empresa sai de dentro dele: sem ela o topo ficava só com o
    // hambúrguer e o sino. O wrapper é quem some/aparece por CSS (`.menu-botao`).
    <div className="menu-botao mr-auto hidden items-center gap-2">
      <button
        type="button"
        onClick={alternarGaveta}
        data-coach={ANCORAS_DO_MENU}
        aria-label="Abrir menu"
        aria-expanded={aberta}
        aria-controls={ID_MENU_LATERAL}
        className="flex h-11 w-11 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Menu className="h-5 w-5" />
      </button>
      <LogoConta width={112} className="text-foreground" />
    </div>
  );
}

/**
 * Fundo escurecido atrás da gaveta (clicar nele fecha). Só aparece por CSS, na faixa e
 * com a gaveta aberta. Também cuida de fechar ao navegar e com Esc.
 */
export function FundoDaGaveta() {
  const aberta = useGavetaAberta();
  const pathname = usePathname();

  // Fecha ao navegar (clicou num item do menu, num atalho da tela, voltou no histórico).
  useEffect(() => {
    definirGaveta(false);
  }, [pathname]);

  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Um menu/popover aberto POR CIMA (tema, empresa) trata o próprio Esc primeiro.
      if (document.querySelector('[role="menu"][data-state="open"], [role="listbox"][data-state="open"]')) return;
      definirGaveta(false);
      document.querySelector<HTMLElement>(".menu-botao button")?.focus();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberta]);

  return (
    <div
      className="menu-fundo hidden"
      data-aberto={aberta ? "true" : "false"}
      aria-hidden="true"
      onClick={() => definirGaveta(false)}
    />
  );
}
