import { z } from "zod";

/**
 * Tabela de preço de frete: empresa + material (ou "qualquer") + modo de serviço
 * (ou "qualquer") + faixa de km + vigência.
 *
 * Espelha `regra-minimo.ts` de propósito — mesma faixa (de inclusivo, até
 * exclusivo), mesma ideia de "null = vale pra qualquer". A diferença é que aqui
 * há vigência, porque preço tem data e mês fechado não pode mudar de valor
 * quando alguém reajusta a tabela.
 */

export const BASES_PRECO = ["TONELADA", "KM", "VIAGEM", "PERIODO"] as const;
export const BasePrecoSchema = z.enum(BASES_PRECO);
export type BasePrecoTipo = z.infer<typeof BasePrecoSchema>;

/** Rótulo e unidade de cada base, pro painel não escrever isso em três lugares. */
export const BASE_PRECO_LABEL: Record<BasePrecoTipo, { nome: string; unidade: string }> = {
  TONELADA: { nome: "Por tonelada", unidade: "R$/t" },
  KM: { nome: "Por quilômetro", unidade: "R$/km" },
  VIAGEM: { nome: "Valor fechado por viagem", unidade: "R$/viagem" },
  PERIODO: { nome: "Por diária", unidade: "R$/dia" },
};

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");

const faixaCoerente = (d: { kmFaixaDe?: number; kmFaixaAte?: number | null }) =>
  d.kmFaixaAte == null || d.kmFaixaDe == null || d.kmFaixaAte > d.kmFaixaDe;

const vigenciaCoerente = (d: { vigenciaDe?: string; vigenciaAte?: string | null }) =>
  d.vigenciaAte == null || d.vigenciaDe == null || d.vigenciaAte >= d.vigenciaDe;

export const CriarTabelaPrecoInput = z
  .object({
    empresaId: z.string().uuid(),
    materialId: z.string().uuid().nullish(),
    tipoServicoId: z.string().uuid().nullish(),
    kmFaixaDe: z.number().nonnegative().max(99999.99),
    kmFaixaAte: z.number().positive().max(99999.99).nullish(),
    base: BasePrecoSchema,
    // Teto alto de propósito: valor fechado de viagem longa passa de mil fácil.
    precoUnitario: z.number().positive().max(9999999.99),
    repassaPedagio: z.boolean().default(false),
    vigenciaDe: DATA,
    vigenciaAte: DATA.nullish(),
  })
  .refine(faixaCoerente, {
    message: "O 'até' precisa ser maior que o 'de'.",
    path: ["kmFaixaAte"],
  })
  .refine(vigenciaCoerente, {
    message: "O fim da vigência não pode ser antes do início.",
    path: ["vigenciaAte"],
  });
export type CriarTabelaPrecoInput = z.infer<typeof CriarTabelaPrecoInput>;

export const AtualizarTabelaPrecoInput = z
  .object({
    empresaId: z.string().uuid().optional(),
    materialId: z.string().uuid().nullish(),
    tipoServicoId: z.string().uuid().nullish(),
    kmFaixaDe: z.number().nonnegative().max(99999.99).optional(),
    kmFaixaAte: z.number().positive().max(99999.99).nullish(),
    base: BasePrecoSchema.optional(),
    precoUnitario: z.number().positive().max(9999999.99).optional(),
    repassaPedagio: z.boolean().optional(),
    vigenciaDe: DATA.optional(),
    vigenciaAte: DATA.nullish(),
    ativo: z.boolean().optional(),
  })
  .refine(faixaCoerente, {
    message: "O 'até' precisa ser maior que o 'de'.",
    path: ["kmFaixaAte"],
  })
  .refine(vigenciaCoerente, {
    message: "O fim da vigência não pode ser antes do início.",
    path: ["vigenciaAte"],
  });
export type AtualizarTabelaPrecoInput = z.infer<typeof AtualizarTabelaPrecoInput>;

/**
 * Alterar à mão o valor calculado de uma viagem.
 *
 * Exige motivo escrito pela mesma razão que alterar o km do motorista exige:
 * o número foi calculado por uma regra pública, e quem o sobrescreve está
 * dizendo que a regra errou. Isso precisa ter nome e justificativa no histórico.
 */
export const AlterarValorViagemInput = z.object({
  valorFrete: z.number().nonnegative().max(9999999.99),
  valorPedagio: z.number().nonnegative().max(9999999.99).default(0),
  motivo: z.string().trim().min(10, "Escreva o motivo (pelo menos 10 letras)."),
});
export type AlterarValorViagemInput = z.infer<typeof AlterarValorViagemInput>;

/** O valor da viagem, como sai pro painel. */
export type ViagemValorDetalhe = {
  base: BasePrecoTipo;
  precoUnitario: string;
  quantidade: string;
  valorFrete: string;
  valorPedagio: string;
  valorTotal: string;
  /** true = alguém sobrescreveu o cálculo. */
  alterado: boolean;
  alteracaoMotivo: string | null;
  calculadoEm: string;
};
