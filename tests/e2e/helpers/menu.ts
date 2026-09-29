import type { Page } from "@playwright/test";

/**
 * Preferência FUTURA do menu lateral do painel.
 *
 * As próximas levas de UX (Leva 1) vão RECOLHER o menu lateral abaixo de 1536px de largura.
 * Os E2E rodam em 1280x720 e localizam itens do menu (`aside a, aside button`), então precisam
 * de um jeito de dizer "quero o menu aberto, fixo". Essa é a chave: a Leva 1 deve LER
 * `localStorage["ronan.menu"] === "fixo"` e, quando for isso, manter o menu aberto em qualquer
 * largura. Enquanto o painel não lê a chave, gravá-la é inofensivo (nada muda).
 *
 * A constante mora aqui pra E2E e testes de UX compartilharem; o painel vai declarar a sua
 * com o MESMO valor — se um lado mudar, o outro tem que acompanhar (grep "ronan.menu").
 */
export const CHAVE_MENU = "ronan.menu";
export const MENU_FIXO = "fixo";

/**
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
