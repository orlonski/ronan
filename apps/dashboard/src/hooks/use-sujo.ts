"use client";

import { useRef } from "react";

/**
 * O formulário mudou desde que abriu?
 *
 * Compara o estado atual com o do primeiro render. É uma comparação por valor
 * (JSON), o que é barato o bastante pro tamanho dos formulários do painel e
 * dispensa registrar cada campo — o custo de manter uma lista de campos "sujos"
 * é justamente o que faz esse tipo de proteção nunca ser implementada.
 *
 * Volta a "limpo" sozinho se a pessoa desfizer o que digitou, o que é o
 * comportamento certo: não há o que perder.
 */
export function useSujo(valor: unknown): boolean {
  const inicial = useRef<string | undefined>(undefined);
  const atual = JSON.stringify(valor);
  if (inicial.current === undefined) inicial.current = atual;
  return inicial.current !== atual;
}
