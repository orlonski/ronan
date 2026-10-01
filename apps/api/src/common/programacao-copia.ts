/**
 * "Repetir a programação de outro dia" — o quadro de amanhã quase sempre é o
 * de hoje: mesmo pedido, mesmo motorista, mesmo caminhão. Montar de novo,
 * linha por linha, é o que faz o supervisor desistir da tela e voltar pro
 * WhatsApp. (Tread e Toro têm o "copiar dia anterior".)
 *
 * Função pura: decide o que copia e por que pula. O service busca e grava.
 */

export type PlanejadaOrigem = {
  id: string;
  pedidoId: string | null;
  motoristaId: string | null;
  veiculoId: string | null;
};

export type SituacaoPedidoCopia = {
  /** Status do Pedido no banco. */
  status: string;
  /** Saldo derivado: "CUMPRIDO" quando já entregou o combinado. */
  cumprido: boolean;
};

export type AcaoCopia = "COPIA" | "JA_EXISTE" | "PEDIDO_ENCERRADO";

const chave = (p: PlanejadaOrigem) => `${p.pedidoId ?? "-"}|${p.motoristaId ?? "-"}|${p.veiculoId ?? "-"}`;

/**
 * Pra cada viagem planejada do dia de origem, o que acontece no destino.
 *
 * - Pedido cancelado, cumprido no status, ou com o saldo já entregue: não
 *   copia (programar viagem pra pedido que acabou é gerar viagem que ninguém
 *   vai pagar).
 * - O destino já tem a mesma combinação pedido+motorista+caminhão: conta
 *   quantas existem e só copia o que falta. Clicar duas vezes não dobra o dia.
 */
export function planejarCopia(
  origem: PlanejadaOrigem[],
  destinoExistente: PlanejadaOrigem[],
  pedidos: Map<string, SituacaoPedidoCopia>,
): { id: string; acao: AcaoCopia }[] {
  const jaNoDestino = new Map<string, number>();
  for (const d of destinoExistente) jaNoDestino.set(chave(d), (jaNoDestino.get(chave(d)) ?? 0) + 1);

  return origem.map((o) => {
    if (o.pedidoId) {
      const p = pedidos.get(o.pedidoId);
      if (!p || p.status === "CANCELADO" || p.status === "CUMPRIDO" || p.cumprido) {
        return { id: o.id, acao: "PEDIDO_ENCERRADO" as const };
      }
    }
    const k = chave(o);
    const restante = jaNoDestino.get(k) ?? 0;
    if (restante > 0) {
      jaNoDestino.set(k, restante - 1);
      return { id: o.id, acao: "JA_EXISTE" as const };
    }
    return { id: o.id, acao: "COPIA" as const };
  });
}
