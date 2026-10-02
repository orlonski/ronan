"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ErroPortal } from "./api";

/**
 * Se uma aba levou 401 (sessão revogada pelo escritório, vencida), recarrega o
 * resumo — que também vai dar 401 e devolver o encarregado pra tela de entrada.
 * Um lugar só decide "a sessão caiu": o `PortalObra`.
 */
export function useSessaoCaiu(erro: unknown, token: string) {
  const qc = useQueryClient();
  React.useEffect(() => {
    if (erro instanceof ErroPortal && erro.status === 401) {
      void qc.invalidateQueries({ queryKey: ["portal-obra", token, "resumo"] });
    }
  }, [erro, qc, token]);
}
