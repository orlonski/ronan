"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Recarrega o comprovante enquanto a viagem está em andamento, pra previsão de
 * chegada não envelhecer na tela de quem deixou o link aberto. `router.refresh`
 * refaz só o render do servidor — sem piscar a página nem perder a rolagem.
 * A API tem cache de 1 min por viagem, então isto não martela o roteador.
 */
export function AtualizaSozinho({ segundos = 60 }: { segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, segundos * 1000);
    return () => clearInterval(id);
  }, [router, segundos]);
  return null;
}
