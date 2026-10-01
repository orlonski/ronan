import type { Page } from "@playwright/test";

// Fonte única da chave: o próprio painel (apps/dashboard/src/lib/menu-preferencia.ts, módulo puro,
// sem alias `@/`) — o mesmo arquivo que o script do <head> do painel usa. Reexportadas aqui pra os
// specs que já importam deste helper não precisarem mudar.
import { CHAVE_MENU, MENU_FIXO, MENU_RECOLHIDO } from "../../../apps/dashboard/src/lib/menu-preferencia";

export { CHAVE_MENU, MENU_FIXO, MENU_RECOLHIDO };

/**
 * Preferência do menu lateral do painel (Leva 2 / fatia 4).
 *
 * Abaixo de 1536px o menu nasce RECOLHIDO numa gaveta (hambúrguer no topo). Os E2E rodam em
 * 1280x720 e localizam itens do menu (`aside a, aside button`), então precisam do menu aberto,
 * fixo: o painel lê `localStorage["ronan.menu"] === "fixo"` ANTES da primeira pintura e mantém a
 * coluna lateral à vista em qualquer largura a partir de 768px.
 *
 * Grava a preferência de menu aberto/fixo em toda página futura do contexto (addInitScript
 * roda antes do JS da página, a cada navegação). Chame ANTES do `page.goto`.
 */
export async function fixarMenuAberto(page: Page): Promise<void> {
  await page.context().addInitScript(
    ([chave, valor]) => {
      try {
        window.localStorage.setItem(chave as string, valor as string);
      } catch {
        /* localStorage bloqueado: o painel cai no comportamento padrão */
      }
    },
    [CHAVE_MENU, MENU_FIXO],
  );
}
