"use client";

import { useSyncExternalStore } from "react";

/**
 * O foco de luz sobre a tela do painel.
 *
 * Porte do `lib/tutorial-state.ts` do app do motorista: um singleton de módulo
 * com listeners, e um host que escuta e desenha. A diferença é onde mora o
 * alvo — no app, cada botão se REGISTRA com uma função de medir, porque no
 * React Native não existe seletor. Na web existe: um atributo `data-coach` num
 * botão que já está lá não mexe em layout, não precisa de ref, funciona em
 * Server Component e não obriga a embrulhar 114 telas.
 */

export type PassoTour = {
  id: string;
  /** `data-coach` do elemento. Nulo = balão no centro, sem furo. */
  alvo: string | null;
  titulo: string;
  corpo: string;
};

export type TourAtivo = {
  chave: string;
  passos: PassoTour[];
  indice: number;
};

type Ouvinte = () => void;

const ouvintes = new Set<Ouvinte>();
let atual: TourAtivo | null = null;

function avisar() {
  for (const o of ouvintes) o();
}

function assinar(fn: Ouvinte): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

function ler(): TourAtivo | null {
  return atual;
}

/** O host lê o tour por aqui. `getServerSnapshot` fixo evita erro de hidratação. */
export function useTour(): TourAtivo | null {
  return useSyncExternalStore(assinar, ler, () => null);
}

/**
 * "Rever o passo a passo": o pedido explícito de quem já viu — ou de quem nunca
 * ia ver, porque o tour automático é só pra quem chegou depois dele.
 *
 * Mora no módulo, e não na URL: a navegação do App Router não recarrega a
 * página, então o pedido sobrevive ao `router.push("/")` e morre num F5 — que é
 * exatamente o tempo de vida que ele deve ter. Na URL, ele reabriria o tour
 * toda vez que a pessoa recarregasse ou compartilhasse o link.
 */
let pedido: string | null = null;

export function pedirTour(chave: string): void {
  pedido = chave;
}

export function pedidoDeTour(): string | null {
  return pedido;
}

export function limparPedidoTour(): void {
  pedido = null;
}

export function comecarTour(chave: string, passos: PassoTour[]): void {
  if (passos.length === 0) return;
  atual = { chave, passos, indice: 0 };
  avisar();
}

export function avancarTour(): void {
  if (!atual) return;
  if (atual.indice >= atual.passos.length - 1) {
    encerrarTour();
    return;
  }
  atual = { ...atual, indice: atual.indice + 1 };
  avisar();
}

export function voltarTour(): void {
  if (!atual || atual.indice === 0) return;
  atual = { ...atual, indice: atual.indice - 1 };
  avisar();
}

/**
 * Sai do tour. `concluido` distingue quem chegou ao fim de quem desistiu —
 * no app do motorista os dois chamavam a mesma função, e "terminou" ficou
 * indistinguível de "pulou".
 */
export function encerrarTour(concluido = true): void {
  if (!atual) return;
  const chave = atual.chave;
  const passo = atual.indice;
  atual = null;
  avisar();
  void marcarVisto(chave, concluido, passo);
}

let aoMarcar: ((chave: string, concluido: boolean, passo: number) => void) | null = null;

/** O host injeta como avisar o servidor — este módulo não conhece fetch. */
export function aoEncerrarTour(fn: typeof aoMarcar): void {
  aoMarcar = fn;
}

function marcarVisto(chave: string, concluido: boolean, passo: number) {
  aoMarcar?.(chave, concluido, passo);
}

/**
 * Onde está o alvo agora, em coordenadas da janela.
 *
 * Devolve `null` quando o elemento não existe ou está colapsado — é o caso do
 * item de menu dentro de um grupo fechado, que mede 0x0. O host trata isso
 * caindo pro balão central em vez de desenhar um furo no canto da tela.
 */
export function medirAlvo(alvo: string): DOMRect | null {
  // querySelectorAll, não querySelector: a topbar é renderizada duas vezes (uma
  // para o header mobile, outra para o desktop) e só uma delas está na tela. O
  // primeiro do DOM costuma ser justamente o escondido, e o furo sairia num
  // canto vazio.
  const todos = document.querySelectorAll<HTMLElement>(`[data-coach="${CSS.escape(alvo)}"]`);
  for (const el of todos) {
    const r = el.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2) return r;
  }
  return null;
}
