import { Prisma, type StatusTitulo } from "@prisma/client";

/**
 * As contas que entram e saem.
 *
 * Duas regras concentram quase todo o risco daqui:
 *
 * 1. **A baixa é um fato, não uma flag.** Um booleano "pago" não responde
 *    "recebemos metade em março e o resto em abril?", que é a pergunta que o
 *    financeiro faz toda semana. O status do título é DERIVADO da soma das
 *    baixas — nunca escrito à mão.
 * 2. **Nada de float.** Todo dinheiro é `Decimal`. Somar centavos em ponto
 *    flutuante produz aquele R$ 0,01 de diferença que ninguém explica e que faz
 *    o cliente desconfiar do sistema inteiro.
 */

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

function dec(v: DecimalLike): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/**
 * O status do título a partir do que foi baixado.
 *
 * `CANCELADO` não é derivado: é decisão de alguém, e recalcular apagaria essa
 * decisão na primeira baixa que chegasse.
 */
export function statusDoTitulo(
  valor: DecimalLike,
  valorPago: DecimalLike,
  atual?: StatusTitulo,
): StatusTitulo {
  if (atual === "CANCELADO") return "CANCELADO";
  const v = dec(valor);
  const pago = dec(valorPago);
  if (pago.lte(0)) return "ABERTO";
  // `gte` e não `eq`: pagamento a maior (juro, arredondamento do banco) quita o
  // título. Deixar PARCIAL um título pago a mais seria perseguir o cliente por
  // uma dívida que não existe.
  if (pago.gte(v)) return "PAGO";
  return "PARCIAL";
}

export type BaixaLida = { valor: DecimalLike };

/** Soma as baixas e devolve o estado do título. */
export function apurarTitulo(
  valor: DecimalLike,
  baixas: BaixaLida[],
  atual?: StatusTitulo,
): { valorPago: string; saldo: string; status: StatusTitulo } {
  const v = dec(valor);
  const pago = baixas.reduce((acc, b) => acc.add(dec(b.valor)), new Prisma.Decimal(0));
  const saldo = v.sub(pago);
  return {
    valorPago: pago.toFixed(2),
    // Saldo nunca negativo na tela: pagou a mais, deve zero.
    saldo: (saldo.gt(0) ? saldo : new Prisma.Decimal(0)).toFixed(2),
    status: statusDoTitulo(v, pago, atual),
  };
}

export type FaixaAging =
  | "A_VENCER"
  | "VENCE_HOJE"
  | "ATE_15"
  | "DE_16_A_30"
  | "DE_31_A_60"
  | "ACIMA_60";

export const AGING_LABEL: Record<FaixaAging, string> = {
  A_VENCER: "A vencer",
  VENCE_HOJE: "Vence hoje",
  ATE_15: "Vencido até 15 dias",
  DE_16_A_30: "Vencido de 16 a 30 dias",
  DE_31_A_60: "Vencido de 31 a 60 dias",
  ACIMA_60: "Vencido há mais de 60 dias",
};

/** Dias entre duas datas, ignorando hora — vencimento é dia, não instante. */
export function diasDeAtraso(vencimento: Date, hoje: Date): number {
  const d = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return Math.round((d(hoje) - d(vencimento)) / 86_400_000);
}

/**
 * A faixa de atraso. As quebras (15, 30, 60) são as que todo financeiro usa —
 * não invente outras, porque é por elas que ele compara com o relatório do
 * contador.
 */
export function faixaDeAging(vencimento: Date, hoje: Date = new Date()): FaixaAging {
  const dias = diasDeAtraso(vencimento, hoje);
  if (dias < 0) return "A_VENCER";
  if (dias === 0) return "VENCE_HOJE";
  if (dias <= 15) return "ATE_15";
  if (dias <= 30) return "DE_16_A_30";
  if (dias <= 60) return "DE_31_A_60";
  return "ACIMA_60";
}

export type TituloParaAging = {
  vencimento: Date;
  valor: DecimalLike;
  valorPago: DecimalLike;
  status: StatusTitulo;
};

/**
 * O relatório de aging: quanto está em cada faixa.
 *
 * Só conta o SALDO de título aberto/parcial. Título pago não aparece (já
 * entrou), cancelado também não (não existe mais) — somar qualquer um dos dois
 * infla o "a receber" e é como se perde a confiança no número.
 */
export function montarAging(
  titulos: TituloParaAging[],
  hoje: Date = new Date(),
): { faixas: Record<FaixaAging, string>; total: string; vencido: string } {
  const zero = () => new Prisma.Decimal(0);
  const acum: Record<FaixaAging, Prisma.Decimal> = {
    A_VENCER: zero(),
    VENCE_HOJE: zero(),
    ATE_15: zero(),
    DE_16_A_30: zero(),
    DE_31_A_60: zero(),
    ACIMA_60: zero(),
  };

  let total = zero();
  let vencido = zero();
  for (const t of titulos) {
    if (t.status === "PAGO" || t.status === "CANCELADO") continue;
    const saldo = dec(t.valor).sub(dec(t.valorPago));
    if (saldo.lte(0)) continue;
    const faixa = faixaDeAging(t.vencimento, hoje);
    acum[faixa] = acum[faixa].add(saldo);
    total = total.add(saldo);
    if (faixa !== "A_VENCER" && faixa !== "VENCE_HOJE") vencido = vencido.add(saldo);
  }

  return {
    faixas: Object.fromEntries(
      Object.entries(acum).map(([k, v]) => [k, v.toFixed(2)]),
    ) as Record<FaixaAging, string>,
    total: total.toFixed(2),
    vencido: vencido.toFixed(2),
  };
}

/**
 * Divide uma fatura em parcelas com vencimento.
 *
 * O resto dos centavos vai na ÚLTIMA parcela, não distribuído: 1000/3 são três
 * de 333,33 e sobra 1 centavo. Jogar na última é o que todo mundo faz, e a soma
 * bate com o total — que é a única coisa que o cliente confere.
 */
export function gerarParcelas(args: {
  valorTotal: DecimalLike;
  parcelas: number;
  /** Primeiro vencimento. As demais caem de 30 em 30 dias. */
  primeiroVencimento: Date;
  intervaloDias?: number;
}): { parcela: number; vencimento: Date; valor: string }[] {
  const total = dec(args.valorTotal);
  const n = Math.max(1, Math.floor(args.parcelas));
  const intervalo = args.intervaloDias ?? 30;

  // Trunca pra baixo em cada parcela; a diferença vai pra última.
  const base = total.div(n).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const saidas: { parcela: number; vencimento: Date; valor: string }[] = [];
  let somado = new Prisma.Decimal(0);

  for (let i = 0; i < n; i++) {
    const ultima = i === n - 1;
    const valor = ultima ? total.sub(somado) : base;
    somado = somado.add(valor);
    const venc = new Date(args.primeiroVencimento);
    venc.setUTCDate(venc.getUTCDate() + i * intervalo);
    saidas.push({ parcela: i + 1, vencimento: venc, valor: valor.toFixed(2) });
  }
  return saidas;
}

/**
 * Vencimento a partir do fim do período e do prazo do cliente.
 *
 * Transportadora fatura por período fechado e o prazo conta do fechamento, não
 * da viagem — "30 dias" significa 30 dias depois do dia 30, não de cada viagem.
 */
export function vencimentoPeloPrazo(fimDoPeriodo: Date, prazoDias: number | null): Date {
  const v = new Date(fimDoPeriodo);
  v.setUTCDate(v.getUTCDate() + (prazoDias ?? 30));
  return v;
}

export type CustoMes = {
  /** Custo fixo do mês: IPVA, seguro, parcela, depreciação. */
  fixo: DecimalLike;
  /** Variável: diesel, pedágio, manutenção. */
  variavel: DecimalLike;
  kmRodado: DecimalLike;
  /** Receita das viagens do veículo no mês. */
  receita?: DecimalLike;
};

/**
 * Custo por km e margem do veículo no mês.
 *
 * É a conta que o dono de transportadora faz de cabeça e a que ele mais quer ver
 * numa tela. Com km zero devolve `null` em vez de zero: dividir por nada daria
 * um número inventado, e um custo/km de R$ 0,00 num caminhão parado é pior que
 * um traço.
 */
export function custoPorKm(m: CustoMes): {
  custoTotal: string;
  custoPorKm: string | null;
  margem: string | null;
  margemPercentual: number | null;
} {
  const fixo = dec(m.fixo);
  const variavel = dec(m.variavel);
  const km = dec(m.kmRodado);
  const custoTotal = fixo.add(variavel);

  const receita = m.receita != null ? dec(m.receita) : null;
  const margem = receita ? receita.sub(custoTotal) : null;

  return {
    custoTotal: custoTotal.toFixed(2),
    custoPorKm: km.gt(0) ? custoTotal.div(km).toFixed(2) : null,
    margem: margem ? margem.toFixed(2) : null,
    margemPercentual:
      receita && receita.gt(0) && margem
        ? Number(margem.div(receita).mul(100).toFixed(1))
        : null,
  };
}
