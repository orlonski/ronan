"use client";

import { useSyncExternalStore } from "react";
import { gravarPreferenciaMenu } from "@/lib/menu-preferencia";

/**
 * Estado da GAVETA do menu lateral (faixa 768–1535px, menu recolhido).
 *
 * Um singleton de módulo com ouvintes, como lib/tour.ts: o botão de hambúrguer (no
 * cabeçalho), a gaveta (sidebar.tsx) e o fundo escurecido leem o mesmo valor sem
 * prop drilling nem contexto. Fora dessa faixa o estado existe mas não tem efeito:
 * quem esconde/mostra a gaveta é o CSS (globals.css, bloco "Menu recolhido").
 */
let aberta = false;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const o of ouvintes) o();
}

function assinar(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

export function useGavetaAberta(): boolean {
  return useSyncExternalStore(
    assinar,
    () => aberta,
    () => false,
  );
}

export function definirGaveta(valor: boolean): void {
  if (aberta === valor) return;
  aberta = valor;
  avisar();
}

export function alternarGaveta(): void {
  definirGaveta(!aberta);
}

/** "Fixar menu": a sidebar volta pro fluxo da página, como nos 1536px+. */
export function fixarMenu(): void {
  gravarPreferenciaMenu("fixo");
  definirGaveta(false);
}

/** "Soltar menu": volta a recolher numa gaveta. */
export function soltarMenu(): void {
  gravarPreferenciaMenu("recolhido");
  definirGaveta(false);
}
