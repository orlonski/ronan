"use client";

import { useEffect, useState } from "react";

/**
 * Persiste preferência de "Cards / Tabela" por tela em localStorage.
 * Default = "cards" (melhor pra notebook). Quem prefere tabela compacta
 * clica 1 vez e a escolha fica.
 */
export type ListViewMode = "cards" | "table";

const PREFIX = "ronan.view-mode.";

function ler(key: string): ListViewMode {
  if (typeof window === "undefined") return "cards";
  try {
    return localStorage.getItem(PREFIX + key) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

export function useListViewMode(key: string): {
  viewMode: ListViewMode;
  setViewMode: (m: ListViewMode) => void;
} {
  const [viewMode, setViewModeState] = useState<ListViewMode>("cards");
  useEffect(() => {
    setViewModeState(ler(key));
  }, [key]);
  function setViewMode(m: ListViewMode): void {
    setViewModeState(m);
    try {
      localStorage.setItem(PREFIX + key, m);
    } catch {
      /* ignora quota */
    }
  }
  return { viewMode, setViewMode };
}
