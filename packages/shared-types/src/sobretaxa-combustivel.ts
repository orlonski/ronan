import { z } from "zod";

/**
 * Sobretaxa de combustível do cliente pagador: "a cada R$ 0,10 de alta no
 * diesel acima da referência, +X% no frete". A conta mora na API
 * (`common/sobretaxa-combustivel.ts`); aqui só o cadastro.
 *
 * Nasce desligada: ligar muda o valor da próxima fatura do cliente.
 */

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");

/** R$/litro com milésimo — o diesel tem 3 casas na bomba. */
const REAIS_LITRO = z.number().positive("Precisa ser maior que zero.").max(99.999);
const PERCENTUAL = z.number().positive("Precisa ser maior que zero.").max(100);

const vigenciaCoerente = (d: { vigenciaDe?: string; vigenciaAte?: string | null }) =>
  d.vigenciaAte == null || d.vigenciaDe == null || d.vigenciaAte >= d.vigenciaDe;

export const CriarRegraSobretaxaInput = z
  .object({
    empresaId: z.string().uuid(),
    /** Default false: a regra nasce desligada e alguém liga de propósito. */
    ativo: z.boolean().default(false),
    dieselReferencia: REAIS_LITRO,
    gatilho: REAIS_LITRO,
    percentualPorPasso: PERCENTUAL,
    tetoPercentual: PERCENTUAL.nullish(),
    vigenciaDe: DATA,
    vigenciaAte: DATA.nullish(),
  })
  .refine(vigenciaCoerente, {
    message: "O fim da vigência não pode ser antes do início.",
    path: ["vigenciaAte"],
  });
export type CriarRegraSobretaxaInput = z.infer<typeof CriarRegraSobretaxaInput>;

export const AtualizarRegraSobretaxaInput = z
  .object({
    ativo: z.boolean().optional(),
    dieselReferencia: REAIS_LITRO.optional(),
    gatilho: REAIS_LITRO.optional(),
    percentualPorPasso: PERCENTUAL.optional(),
    tetoPercentual: PERCENTUAL.nullish(),
    vigenciaDe: DATA.optional(),
    vigenciaAte: DATA.nullish(),
  })
  .refine(vigenciaCoerente, {
    message: "O fim da vigência não pode ser antes do início.",
    path: ["vigenciaAte"],
  });
export type AtualizarRegraSobretaxaInput = z.infer<typeof AtualizarRegraSobretaxaInput>;

/** De onde veio o preço do diesel usado na conta. */
export const ORIGENS_PRECO_DIESEL = ["MEDIA_ABASTECIMENTOS", "INFORMADO"] as const;
export type OrigemPrecoDiesel = (typeof ORIGENS_PRECO_DIESEL)[number];

/** Os números congelados em `FaturaLinha.sobretaxa`. */
export type SobretaxaCongelada = {
  regraId: string;
  origemPreco: OrigemPrecoDiesel;
  precoDiesel: string;
  /** Só na média: quantos litros e abastecimentos formaram o preço. */
  litros: string | null;
  abastecimentos: number | null;
  dieselReferencia: string;
  gatilho: string;
  percentualPorPasso: string;
  tetoPercentual: string | null;
  passos: number;
  percentual: string;
  limitadoPeloTeto: boolean;
  base: string;
  valor: string;
};

/**
 * O que a prévia da fatura diz sobre a sobretaxa. `null` na resposta = o
 * cliente não tem regra ligada pro período (a fatura sai como sempre saiu).
 */
export type PreviaSobretaxa = {
  regra: {
    id: string;
    dieselReferencia: string;
    gatilho: string;
    percentualPorPasso: string;
    tetoPercentual: string | null;
  };
  /** Vai virar linha da fatura. False = a prévia explica em `motivo`. */
  aplica: boolean;
  motivo: string | null;
  /** Média dos abastecimentos do período, mesmo quando um preço à mão sobrepõe. */
  media: { preco: string; litros: string; abastecimentos: number } | null;
  calculo: (SobretaxaCongelada & { descricao: string }) | null;
};
