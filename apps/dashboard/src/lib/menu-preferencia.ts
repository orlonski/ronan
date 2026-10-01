/**
 * Preferência do menu lateral, POR PESSOA (localStorage deste navegador).
 *
 * Só vale na faixa 768–1535px: ali o menu nasce RECOLHIDO numa gaveta (botão de
 * hambúrguer no topo) e a pessoa pode FIXAR. Do 1536px pra cima o menu é sempre
 * fixo, com ou sem preferência; no celular a navegação é a barra inferior.
 *
 * Este módulo é PURO (sem alias `@/`, sem React) de propósito: o `layout.tsx` injeta
 * `SCRIPT_MENU_INICIAL` no <head> pra o atributo `data-menu` do <html> existir ANTES da
 * primeira pintura (CSS-first: sem piscar menu aberto -> recolhido, sem ler a largura da
 * janela no render), e os E2E (`tests/e2e/helpers/menu.ts`) importam a chave daqui — fonte
 * única, nada de duas constantes com o mesmo valor.
 */
export const CHAVE_MENU = "ronan.menu";
export const MENU_FIXO = "fixo";
export const MENU_RECOLHIDO = "recolhido";
export type PreferenciaMenu = typeof MENU_FIXO | typeof MENU_RECOLHIDO;

/** Atributo no <html> que o CSS lê (`html[data-menu="fixo"]`). Ausente = recolhido. */
export const ATRIBUTO_MENU = "data-menu";

/**
 * Roda no <head>, síncrono, antes do body. Sem localStorage (bloqueado, janela privada)
 * cai no padrão: recolhido.
 */
export const SCRIPT_MENU_INICIAL = `(function(){var v="${MENU_RECOLHIDO}";try{if(localStorage.getItem("${CHAVE_MENU}")==="${MENU_FIXO}")v="${MENU_FIXO}"}catch(e){}document.documentElement.setAttribute("${ATRIBUTO_MENU}",v)})()`;

export function lerPreferenciaMenu(): PreferenciaMenu {
  try {
    return window.localStorage.getItem(CHAVE_MENU) === MENU_FIXO ? MENU_FIXO : MENU_RECOLHIDO;
  } catch {
    return MENU_RECOLHIDO;
  }
}

/** Grava a preferência e já reflete no <html> (o CSS troca o menu na hora). */
export function gravarPreferenciaMenu(pref: PreferenciaMenu): void {
  try {
    window.localStorage.setItem(CHAVE_MENU, pref);
  } catch {
    /* sem storage: vale só até recarregar */
  }
  document.documentElement.setAttribute(ATRIBUTO_MENU, pref);
}
