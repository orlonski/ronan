/**
 * O QUE UM INTERRUPTOR DA FICHA FAZ NAS REGRAS — a decisão, sem banco.
 *
 * Empresa nas regras não tem "coluna pra ligar": a diferença de uma pessoa é
 * exceção. Regra do interruptor:
 *   - já está como pedido → nada;
 *   - o pedido é o que o GRUPO dele já dá → desfaz a exceção que existia
 *     (o "só dele" some quando não há mais diferença, em vez de empilhar);
 *   - senão → exceção CONCEDER (ligar) ou NEGAR (desligar).
 */
export type EstadoDoItem = { baseTem: boolean; concedido: boolean };
export type AcaoDoAjuste = "NADA" | "DESFAZER" | "CONCEDER" | "NEGAR";

export function decidirAjuste(estado: EstadoDoItem, ligado: boolean): AcaoDoAjuste {
  if (estado.concedido === ligado) return "NADA";
  if (ligado === estado.baseTem) return "DESFAZER";
  return ligado ? "CONCEDER" : "NEGAR";
}
