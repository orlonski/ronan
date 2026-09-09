import { useEffect } from "react";
import { iniciarAnalytics } from "./analytics";

/**
 * Conta a visita uma vez por carregamento.
 *
 * O guard de módulo existe por causa do StrictMode do React 19, que monta o
 * componente duas vezes em desenvolvimento — sem ele, todo pageview local
 * contaria em dobro e a estatística nasceria mentindo.
 */
let jaContou = false;

export function useAnalytics(): void {
  useEffect(() => {
    if (jaContou) return;
    jaContou = true;
    iniciarAnalytics();
  }, []);
}
