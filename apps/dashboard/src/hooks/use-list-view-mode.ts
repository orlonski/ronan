"use client";

import { useEffect, useState } from "react";

/**
 * Persiste preferência de "Cards / Tabela" por tela em localStorage.
 * Default = "cards" (melhor pra notebook). Quem prefere tabela compacta
 * clica 1 vez e a escolha fica.
 *
 * No celular (< 768px) o modo é SEMPRE "cards": tabela larga não cabe na tela, e o seletor some
 * (`ViewModeToggle`). A preferência salva NÃO é apagada nem sobrescrita — ao voltar pra uma tela
 * larga (ou no desktop, no mesmo navegador) ela continua valendo.
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
  const [preferido, setViewModeState] = useState<ListViewMode>("cards");
  const [celular, setCelular] = useState(false);
  useEffect(() => {
    setViewModeState(ler(key));
  }, [key]);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const aoMudar = () => setCelular(mq.matches);
    aoMudar();
    mq.addEventListener("change", aoMudar);
    return () => mq.removeEventListener("change", aoMudar);
  }, []);
  const viewMode: ListViewMode = celular ? "cards" : preferido;
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
