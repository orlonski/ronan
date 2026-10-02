import { Prisma } from "@prisma/client";

/**
 * Sobretaxa de combustível na fatura do cliente.
 *
 * O frete é combinado com o diesel de um dia; quando o diesel sobe, a margem
 * da transportadora some calada até alguém renegociar a tabela. O contrato de
 * granel costuma ter a cláusula "a cada R$ 0,10 de alta no diesel, +1% no
 * frete" — e ninguém aplica, porque fazer a conta à mão todo mês dá trabalho.
 *
 * Regras que esta conta segue, e por quê:
 *   - Os PASSOS são inteiros: R$ 0,09 acima da referência com gatilho de
 *     R$ 0,10 é zero passo. É o que o contrato diz, e é o que deixa a conta
 *     conferível de cabeça pelo cliente.
 *   - Toda a aritmética é Decimal. Em float, (6,30 − 6,00) / 0,10 dá
 *     2,9999… e o floor cobraria um passo a menos.
 *   - DIESEL CAINDO NÃO DÁ DESCONTO. A sobretaxa protege a margem contra a
 *     alta; abaixo da referência o preço da tabela já é o combinado. Se um
 *     contrato pedir a mão inversa, é outra regra — não um sinal trocado aqui.
 *   - O teto limita o percentual, não os passos: a descrição mostra os passos
 *     reais e diz que o teto cortou.
 *   - Base = frete das viagens (`ViagemValor.valorFrete`). Pedágio repassado e
 *     estadia ficam fora: pedágio é reembolso do que foi pago na praça, e a
 *     estadia é hora parada — nenhum dos dois gasta diesel.
 */

type DecimalLike = Prisma.Decimal | string | number;

const dec = (v: DecimalLike) => (v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v));

export type RegraSobretaxa = {
  /** R$/litro do diesel quando o frete foi combinado. */
  dieselReferencia: DecimalLike;
  /** De quanto em quanto R$/litro de alta conta um passo (ex.: 0,10). */
  gatilho: DecimalLike;
  /** Quantos % cada passo acrescenta (ex.: 1). */
  percentualPorPasso: DecimalLike;
  /** Limite do percentual total. Null = sem teto. */
  tetoPercentual?: DecimalLike | null;
};

export type AbastecimentoParaDiesel = {
  litros: DecimalLike;
  valorTotal: DecimalLike | null;
};

export type PrecoDiesel = {
  /** R$/litro, 3 casas (a mesma precisão de `Abastecimento.precoLitro`). */
  preco: Prisma.Decimal;
  litros: Prisma.Decimal;
  abastecimentos: number;
};

/**
 * Média PONDERADA pelos litros: soma do que se pagou ÷ soma dos litros. A média
 * simples dos preços daria o mesmo peso a 20 litros num posto caro e a 600
 * litros no contrato com a distribuidora — e o diesel que pesa no custo é o
 * dos 600. Abastecimento sem valor (comboio ainda sem preço) não entra: não
 * diz nada sobre preço.
 */
export function precoMedioDiesel(abastecimentos: AbastecimentoParaDiesel[]): PrecoDiesel | null {
  let valor = new Prisma.Decimal(0);
  let litros = new Prisma.Decimal(0);
  let n = 0;
  for (const a of abastecimentos) {
    if (a.valorTotal == null) continue;
    const l = dec(a.litros);
    const v = dec(a.valorTotal);
    if (l.lte(0) || v.lte(0)) continue;
    valor = valor.add(v);
    litros = litros.add(l);
    n++;
  }
  if (n === 0 || litros.lte(0)) return null;
  return {
    preco: valor.div(litros).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP),
    litros: litros.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP),
    abastecimentos: n,
  };
}

export type SobretaxaCalculada = {
  precoDiesel: string;
  dieselReferencia: string;
  gatilho: string;
  percentualPorPasso: string;
  tetoPercentual: string | null;
  passos: number;
  /** Percentual aplicado, já com o teto. */
  percentual: string;
  /** O teto cortou o percentual dos passos. */
  limitadoPeloTeto: boolean;
  base: string;
  valor: string;
  /** Uma linha só, pra ir na `FaturaLinha.descricao` e no PDF. */
  descricao: string;
};

/** "6,42" com no mínimo 2 e no máximo 3 casas — o diesel tem milésimo. */
function reais(v: Prisma.Decimal, casasMax = 2): string {
  const casas = Math.max(2, Math.min(casasMax, v.decimalPlaces()));
  return `R$ ${v
    .toNumber()
    .toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}

function pct(v: Prisma.Decimal): string {
  return `${v.toNumber().toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
}

/**
 * A conta. Devolve sempre o resultado — com `passos: 0` e `valor: "0.00"`
 * quando o diesel não passou da referência — pra tela poder dizer o porquê.
 */
export function calcularSobretaxa(
  regra: RegraSobretaxa,
  precoDiesel: DecimalLike,
  base: DecimalLike,
): SobretaxaCalculada {
  const atual = dec(precoDiesel);
  const ref = dec(regra.dieselReferencia);
  const gatilho = dec(regra.gatilho);
  const porPasso = dec(regra.percentualPorPasso);
  const teto = regra.tetoPercentual != null ? dec(regra.tetoPercentual) : null;
  const b = dec(base).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  if (gatilho.lte(0)) throw new Error("Gatilho da sobretaxa precisa ser maior que zero");

  const alta = atual.sub(ref);
  // Sem desconto: alta zero ou negativa é zero passo, nunca passo negativo.
  const passos = alta.gt(0) ? alta.div(gatilho).floor().toNumber() : 0;

  let percentual = porPasso.mul(passos);
  let limitadoPeloTeto = false;
  if (teto != null && percentual.gt(teto)) {
    percentual = teto;
    limitadoPeloTeto = true;
  }
  if (percentual.lt(0)) percentual = new Prisma.Decimal(0);

  const valor = b.mul(percentual).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  const descricao =
    passos === 0
      ? `Sobretaxa de combustível: diesel médio ${reais(atual, 3)} x referência ${reais(ref, 3)} → ` +
        `não passou de um passo de ${reais(gatilho, 3)}, sem sobretaxa`
      : `Sobretaxa de combustível: diesel médio ${reais(atual, 3)} x referência ${reais(ref, 3)} → ` +
        `${passos} ${passos === 1 ? "passo" : "passos"} de ${reais(gatilho, 3)} × ${pct(porPasso)}` +
        (limitadoPeloTeto ? ` (teto ${pct(teto!)})` : "") +
        ` = ${pct(percentual)} sobre ${reais(b)}`;

  return {
    precoDiesel: atual.toFixed(3),
    dieselReferencia: ref.toFixed(3),
    gatilho: gatilho.toFixed(3),
    percentualPorPasso: porPasso.toFixed(3),
    tetoPercentual: teto ? teto.toFixed(3) : null,
    passos,
    percentual: percentual.toFixed(3),
    limitadoPeloTeto,
    base: b.toFixed(2),
    valor: valor.toFixed(2),
    descricao,
  };
}

/** Tipos de combustível que entram no preço do diesel. ARLA e gasolina não são diesel. */
export const TIPOS_DIESEL = ["DIESEL_S10", "DIESEL_S500"] as const;
