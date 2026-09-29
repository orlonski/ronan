"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

/**
 * O que o cabeçalho do CELULAR mostra além da rota: o título e o destino do
 * "Voltar" que a tela quer. Sem declaração, o cabeçalho cai no fallback do menu
 * (lib/menu.ts → tituloDaRota) e o Voltar volta no histórico — então as telas
 * que nunca ouviram falar disto já ganham cabeçalho de app.
 *
 * Duas contextos separados de propósito: a tela só ESCREVE (setter estável, não
 * re-renderiza quando o cabeçalho muda) e o cabeçalho só LÊ.
 */
export type CabecalhoDeclarado = { titulo: string | null; voltarHref: string | null };

const VAZIO: CabecalhoDeclarado = { titulo: null, voltarHref: null };
const LeituraCtx = createContext<CabecalhoDeclarado>(VAZIO);
const EscritaCtx = createContext<((c: CabecalhoDeclarado) => void) | null>(null);

export function CabecalhoProvider({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<CabecalhoDeclarado>(VAZIO);
  const escrever = useMemo(() => (c: CabecalhoDeclarado) => setEstado(c), []);
  return (
    <EscritaCtx.Provider value={escrever}>
      <LeituraCtx.Provider value={estado}>{children}</LeituraCtx.Provider>
    </EscritaCtx.Provider>
  );
}

export function useCabecalhoDeclarado(): CabecalhoDeclarado {
  return useContext(LeituraCtx);
}

const useEfeitoIsomorfico = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A tela declara o título (e, se quiser, pra onde o Voltar vai) do cabeçalho do
 * celular. Limpa sozinha quando a tela sai. Fora do shell do painel não faz nada.
 */
export function usePageTitle(titulo: string | null | undefined, voltarHref?: string | null) {
  const escrever = useContext(EscritaCtx);
  useEfeitoIsomorfico(() => {
    if (!escrever || !titulo) return;
    escrever({ titulo, voltarHref: voltarHref ?? null });
    return () => escrever(VAZIO);
  }, [escrever, titulo, voltarHref]);
}

/** Versão em componente, pra quem não pode chamar hook (ex.: dentro de condicional). */
export function PageTitle({ titulo, voltarHref }: { titulo: string; voltarHref?: string | null }) {
  usePageTitle(titulo, voltarHref);
  return null;
}
