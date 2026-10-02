import { Prisma } from "@prisma/client";

/**
 * Tonelada ↔ m³ pela densidade do material.
 *
 * A balança pesa em tonelada; granel (brita, areia, pó de pedra) se vende em
 * m³. A ponte é a densidade a granel do material (`Material.densidadeTonM3`,
 * t/m³): m³ = t ÷ densidade.
 *
 * A regra que organiza tudo aqui: SEM DENSIDADE NÃO HÁ CONVERSÃO. Nunca se
 * chuta "1,5, que é mais ou menos tudo" — 1,35 contra 1,6 é 18% de diferença no
 * volume, e isso é a margem inteira do frete. Quem pede a conversão recebe um
 * resultado tipado dizendo que não deu, e decide o que mostrar (saldo
 * indisponível, viagem sem valor). Zero nunca: zero parece conferido.
 */

type DecimalLike = Prisma.Decimal | string | number;

export type MotivoSemConversao = "SEM_DENSIDADE";

export type ConversaoVolume =
  | { ok: true; valor: Prisma.Decimal }
  | { ok: false; motivo: MotivoSemConversao };

/** Casas do m³ e da tonelada convertidos — as mesmas 3 do banco (Decimal(12,3)). */
export const CASAS_VOLUME = 3;

function dec(v: DecimalLike): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

/**
 * Densidade utilizável, ou null. Zero e negativo contam como "não informada":
 * densidade 0 é divisão por zero, e o banco já recusa fora de 0,3–3,5.
 */
export function densidadeValida(
  densidade: DecimalLike | null | undefined,
): Prisma.Decimal | null {
  if (densidade == null) return null;
  const d = dec(densidade);
  if (!d.isFinite() || d.lte(0)) return null;
  return d;
}

/**
 * Toneladas → m³, arredondado em 3 casas. Arredondar AQUI, e não no fim da
 * conta, é de propósito: quem precifica grava este m³ e multiplica o preço por
 * ele — o valor tem que ser reconstituível com o número que está na tela.
 */
export function toneladasParaM3(
  toneladas: DecimalLike,
  densidade: DecimalLike | null | undefined,
): ConversaoVolume {
  const d = densidadeValida(densidade);
  if (!d) return { ok: false, motivo: "SEM_DENSIDADE" };
  return {
    ok: true,
    valor: dec(toneladas).div(d).toDecimalPlaces(CASAS_VOLUME, Prisma.Decimal.ROUND_HALF_UP),
  };
}

/** m³ → toneladas, arredondado em 3 casas. */
export function m3ParaToneladas(
  m3: DecimalLike,
  densidade: DecimalLike | null | undefined,
): ConversaoVolume {
  const d = densidadeValida(densidade);
  if (!d) return { ok: false, motivo: "SEM_DENSIDADE" };
  return {
    ok: true,
    valor: dec(m3).mul(d).toDecimalPlaces(CASAS_VOLUME, Prisma.Decimal.ROUND_HALF_UP),
  };
}

/** Texto pro painel quando a conversão não deu. */
export const SEM_CONVERSAO_TEXTO: Record<MotivoSemConversao, string> = {
  SEM_DENSIDADE: "Cadastre a densidade do material (t/m³) pra converter o peso em volume.",
};
