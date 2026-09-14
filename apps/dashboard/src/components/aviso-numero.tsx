"use client";

import { lerNumero, formatarBRL } from "@/lib/numero";

/**
 * A linha embaixo de um campo numérico que diz o que o sistema entendeu.
 *
 * Serve a dois erros que só aparecem depois de salvar:
 * - número ilegível ("12,5,0"), que antes era descartado como campo vazio;
 * - ponto decimal em campo de dinheiro, onde "2400.50" já foi lido como
 *   R$ 240.050,00. Mostrar o valor entendido enquanto se digita é mais barato
 *   que qualquer confirmação depois.
 *
 * Fica em silêncio quando o campo está vazio ou quando não há o que esclarecer.
 */
export function AvisoNumero({
  valor,
  dinheiro,
}: {
  valor: string;
  /** Ecoa o valor formatado em reais — só pra campo de dinheiro. */
  dinheiro?: boolean;
}) {
  if (!valor.trim()) return null;
  const lido = lerNumero(valor);

  if (!lido.ok) {
    return (
      <p role="alert" className="text-xs text-destructive">
        Não entendi esse número. Use vírgula só uma vez, sem letra — ex.: 12,5
      </p>
    );
  }

  if (dinheiro && lido.valor != null) {
    return (
      <p className="text-xs text-muted-foreground">
        Vai lançar <strong className="text-foreground">{formatarBRL(lido.valor)}</strong>
      </p>
    );
  }

  return null;
}
