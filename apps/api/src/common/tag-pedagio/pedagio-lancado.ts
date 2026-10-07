import { Prisma } from "@prisma/client";

/**
 * O pedágio que o motorista lançou × o que a tag pagou na MESMA viagem
 * (conferência da tag, Onda 2). Funções puras: o acerto e o lucro por
 * caminhão usam as mesmas, senão um diz "reembolsar R$ 42" e o outro conta R$ 120.
 *
 * A regra: o que a tag (ou o vale do contratante) pagou numa praça, o motorista
 * não pagou do bolso. Devolver o lançado inteiro seria pagar o pedágio duas
 * vezes — uma pro Sem Parar, outra pro motorista. Mas é SUGESTÃO: a tag pode ter
 * falhado numa praça, ele pode ter pago a volta em dinheiro. Quem decide o valor
 * é a empresa, e a decisão fica com autor.
 */

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

function dec(v: DecimalLike): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/**
 * O que a tag e o vale pagaram nas passagens ligadas a UMA viagem (só ligação
 * feita, nunca sugestão). `retorno` é a volta vazia ligada a ela: fica FORA da
 * sugestão — o motorista pode ter lançado só a ida, paga em dinheiro, e
 * descontar a volta dele seria tirar dinheiro do parceiro com um clique.
 */
export type CoberturaTag = {
  tag: DecimalLike;
  vale: DecimalLike;
  /** Tag (só tag, sem vale) nos trechos de volta vazia ligados à viagem. */
  retorno?: DecimalLike;
  trechos: number;
  /** Quantos trechos de ida (não-retorno) estão ligados. */
  trechosIda?: number;
  /** Quantos trechos de volta vazia estão ligados. */
  trechosVolta?: number;
};

export type ReguaPedagioTag = "IDA" | "VOLTA" | "IDA_E_VOLTA";

/**
 * O pedágio desta viagem pela fatura da tag, na régua do cliente. Só o que a
 * TAG pagou — vale-pedágio nunca: quem pagou foi o contratante, e cobrar de
 * novo do cliente é cobrar duas vezes.
 *
 * null = a parte que a régua pede não está ligada (ex.: régua "ida" e só a
 * volta foi casada): aí vale o que o motorista lançou, como sempre foi.
 */
export function pedagioPelaTag(cobertura: CoberturaTag | null | undefined, regua: ReguaPedagioTag): Prisma.Decimal | null {
  if (!cobertura || cobertura.trechos === 0) return null;
  const temIda = (cobertura.trechosIda ?? 0) > 0;
  const temVolta = (cobertura.trechosVolta ?? 0) > 0;
  const ida = dec(cobertura.tag);
  const volta = dec(cobertura.retorno);
  if (regua === "IDA") return temIda ? ida : null;
  if (regua === "VOLTA") return temVolta ? volta : null;
  return temIda ? ida.add(volta) : null;
}

/** O pedágio que vai pro cliente: o da tag quando há, senão o lançado. Fonte única. */
export function pedagioDoCliente(v: { pedagioPelaTag?: DecimalLike; valorPedagioTotal?: DecimalLike }): Prisma.Decimal {
  return v.pedagioPelaTag != null ? dec(v.pedagioPelaTag) : dec(v.valorPedagioTotal);
}

export type SituacaoTagDaViagem =
  /** O caminhão não aparece em fatura nenhuma: não tem tag, ou a empresa não sobe a fatura. */
  | { situacao: "SEM_TAG" }
  /** Tem tag, mas nenhuma fatura importada cobre o dia da viagem ainda. */
  | { situacao: "FATURA_NAO_CHEGOU" }
  /** A fatura cobre o dia, e nenhuma passagem foi ligada a esta viagem. */
  | { situacao: "NAO_CASADA" }
  /** Passagens ligadas: a tag e/ou o vale pagaram parte (ou tudo) do lançado. */
  | { situacao: "TAG_PAGOU"; tag: string; vale: string; retorno: string; sugestao: string };

/**
 * Quanto sugerir devolver: o lançado menos o que a tag e o vale cobriram,
 * nunca negativo (a tag ter pago MAIS do que ele lançou não é dívida dele).
 */
export function sugestaoDeReembolso(lancado: DecimalLike, cobertura: CoberturaTag): Prisma.Decimal {
  const resto = dec(lancado).sub(dec(cobertura.tag)).sub(dec(cobertura.vale));
  return resto.gt(0) ? resto : new Prisma.Decimal(0);
}

export function situacaoTagDaViagem(args: {
  /** O caminhão aparece em alguma fatura importada. */
  temTag: boolean;
  /** Alguma fatura importada cobre o dia da viagem. */
  faturaCobreODia: boolean;
  cobertura: CoberturaTag | null;
  lancado: DecimalLike;
}): SituacaoTagDaViagem {
  if (args.cobertura && args.cobertura.trechos > 0) {
    return {
      situacao: "TAG_PAGOU",
      tag: dec(args.cobertura.tag).toFixed(2),
      vale: dec(args.cobertura.vale).toFixed(2),
      retorno: dec(args.cobertura.retorno).toFixed(2),
      sugestao: sugestaoDeReembolso(args.lancado, args.cobertura).toFixed(2),
    };
  }
  if (!args.temTag) return { situacao: "SEM_TAG" };
  if (!args.faturaCobreODia) return { situacao: "FATURA_NAO_CHEGOU" };
  return { situacao: "NAO_CASADA" };
}

/** Tag + vale da ida — o que a decisão guarda em `valorTag` e a sugestão desconta. */
export function pagoNaIda(cobertura: CoberturaTag | null | undefined): Prisma.Decimal {
  if (!cobertura) return new Prisma.Decimal(0);
  return dec(cobertura.tag).add(dec(cobertura.vale));
}

/**
 * A decisão só vale pros números sobre os quais foi tomada: o lançado E o que a
 * tag pagou. Motorista corrigiu o valor, ou a ligação da passagem foi desfeita
 * (era de outra viagem)? A viagem volta pra conferência — aplicar a decisão
 * velha em números novos seria decidir sem ninguém ter olhado.
 */
export function decisaoAindaVale(
  decisao: { valorLancado: DecimalLike; valorTag: DecimalLike },
  lancadoAtual: DecimalLike,
  cobertura: CoberturaTag | null | undefined,
): boolean {
  return dec(decisao.valorLancado).eq(dec(lancadoAtual)) && dec(decisao.valorTag).eq(pagoNaIda(cobertura));
}

/**
 * O ajuste que leva a decisão pro acerto seguinte quando o reembolso já foi
 * pago num acerto fechado (acerto fechado não reabre). Negativo = desconta.
 * Zero = nada a ajustar.
 */
export function ajusteDaDecisao(valorReembolso: DecimalLike, jaPago: DecimalLike): Prisma.Decimal {
  return dec(valorReembolso).sub(dec(jaPago));
}
