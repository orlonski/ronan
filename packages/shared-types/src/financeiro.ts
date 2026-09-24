import { z } from "zod";

/** Contas a receber, a pagar e a fatura que liga o fechamento ao dinheiro. */

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");

export const STATUS_FATURA = ["RASCUNHO", "EMITIDA", "ENVIADA", "CANCELADA"] as const;
export const STATUS_TITULO = ["ABERTO", "PARCIAL", "PAGO", "CANCELADO"] as const;
export const TIPOS_FORNECEDOR = [
  "POSTO",
  "OFICINA",
  "PNEU",
  "SEGURADORA",
  "PEDAGIO",
  "OUTRO",
] as const;

export const StatusFaturaSchema = z.enum(STATUS_FATURA);
export const StatusTituloSchema = z.enum(STATUS_TITULO);
export const TipoFornecedorSchema = z.enum(TIPOS_FORNECEDOR);
export type StatusFaturaTipo = z.infer<typeof StatusFaturaSchema>;
export type StatusTituloTipo = z.infer<typeof StatusTituloSchema>;
export type TipoFornecedorTipo = z.infer<typeof TipoFornecedorSchema>;

export const STATUS_TITULO_LABEL: Record<StatusTituloTipo, string> = {
  ABERTO: "Em aberto",
  PARCIAL: "Pago em parte",
  PAGO: "Pago",
  CANCELADO: "Cancelado",
};

export const STATUS_FATURA_LABEL: Record<StatusFaturaTipo, string> = {
  RASCUNHO: "Rascunho",
  EMITIDA: "Emitida",
  ENVIADA: "Enviada ao cliente",
  CANCELADA: "Cancelada",
};

export const TIPO_FORNECEDOR_LABEL: Record<TipoFornecedorTipo, string> = {
  POSTO: "Posto",
  OFICINA: "Oficina",
  PNEU: "Borracharia / pneus",
  SEGURADORA: "Seguradora",
  PEDAGIO: "Pedágio",
  OUTRO: "Outro",
};

export const FAIXAS_AGING = [
  "A_VENCER",
  "VENCE_HOJE",
  "ATE_15",
  "DE_16_A_30",
  "DE_31_A_60",
  "ACIMA_60",
] as const;
export type FaixaAgingTipo = (typeof FAIXAS_AGING)[number];

export const AGING_LABEL_UI: Record<FaixaAgingTipo, string> = {
  A_VENCER: "A vencer",
  VENCE_HOJE: "Vence hoje",
  ATE_15: "Até 15 dias",
  DE_16_A_30: "16 a 30 dias",
  DE_31_A_60: "31 a 60 dias",
  ACIMA_60: "Mais de 60 dias",
};

/**
 * Gera a fatura de um fechamento conferido.
 *
 * É o caminho normal: o fechamento vira cobrança. Faturar avulso existe pro
 * que não passou por fechamento (estadia, reentrega, serviço fora do contrato).
 */
export const GerarFaturaInput = z
  .object({
    empresaId: z.string().uuid(),
    /** Quando vem de um fechamento conferido. */
    fechamentoId: z.string().uuid().nullish(),
    periodoInicio: DATA,
    periodoFim: DATA,
    /** Em quantas vezes. O vencimento sai do prazo da empresa. */
    parcelas: z.number().int().min(1).max(12).default(1),
    /** Sobrescreve o prazo cadastrado na empresa, quando for o caso. */
    prazoDias: z.number().int().min(0).max(365).nullish(),
    observacao: z.string().trim().max(500).nullish(),
  })
  .refine((d) => d.periodoFim >= d.periodoInicio, {
    message: "O fim do período não pode ser antes do início.",
    path: ["periodoFim"],
  });
export type GerarFaturaInput = z.infer<typeof GerarFaturaInput>;

export const AtualizarFaturaInput = z.object({
  status: StatusFaturaSchema.optional(),
  documentoNumero: z.string().trim().max(30).nullish(),
  documentoChave: z.string().trim().max(60).nullish(),
  observacao: z.string().trim().max(500).nullish(),
});
export type AtualizarFaturaInput = z.infer<typeof AtualizarFaturaInput>;

/**
 * Dar baixa num título.
 *
 * Valor sempre positivo e menor ou igual ao saldo: baixa maior que a dívida é
 * quase sempre dedo errado, e aceitar calado faz o relatório mentir.
 */
export const DarBaixaInput = z.object({
  valor: z.number().positive().max(9999999.99),
  data: DATA.optional(),
  meio: z.string().trim().min(2).max(40).default("PIX"),
  observacao: z.string().trim().max(300).nullish(),
});
export type DarBaixaInput = z.infer<typeof DarBaixaInput>;

/** Conta a pagar lançada errado ou que não vai ser paga (o serviço não aconteceu). */
export const CancelarTituloPagarInput = z.object({
  motivo: z.string().trim().min(3, "Diga por que a conta foi cancelada.").max(300),
});
export type CancelarTituloPagarInput = z.infer<typeof CancelarTituloPagarInput>;

/** Conta a pagar lançada à mão: oficina, posto, seguro, parcela. */
export const CriarTituloPagarInput = z
  .object({
    descricao: z.string().trim().min(3).max(200),
    valor: z.number().positive().max(9999999.99),
    emissao: DATA.optional(),
    vencimento: DATA,
    /** No máximo UM destes. O backend recusa se vier mais de um. */
    motoristaId: z.string().uuid().nullish(),
    transportadoraId: z.string().uuid().nullish(),
    fornecedorId: z.string().uuid().nullish(),
    /** Pra custo entrar no cálculo por veículo. */
    veiculoId: z.string().uuid().nullish(),
    observacao: z.string().trim().max(300).nullish(),
  })
  .refine(
    (d) =>
      [d.motoristaId, d.transportadoraId, d.fornecedorId].filter(Boolean).length <= 1,
    {
      message: "Escolha só um: motorista, frota ou fornecedor.",
      path: ["fornecedorId"],
    },
  );
export type CriarTituloPagarInput = z.infer<typeof CriarTituloPagarInput>;

export const CriarFornecedorInput = z.object({
  nome: z.string().trim().min(2).max(120),
  cnpjCpf: z.string().trim().max(20).nullish(),
  tipo: TipoFornecedorSchema.default("OUTRO"),
  telefone: z.string().trim().max(20).nullish(),
  observacao: z.string().trim().max(300).nullish(),
});
export type CriarFornecedorInput = z.infer<typeof CriarFornecedorInput>;

export const AtualizarFornecedorInput = CriarFornecedorInput.partial().extend({
  ativo: z.boolean().optional(),
});
export type AtualizarFornecedorInput = z.infer<typeof AtualizarFornecedorInput>;

/** Custo fixo recorrente do veículo: IPVA, seguro, parcela, depreciação. */
export const CriarCustoFixoInput = z
  .object({
    veiculoId: z.string().uuid(),
    tipo: z.string().trim().min(2).max(40),
    valorMensal: z.number().positive().max(999999.99),
    vigenciaDe: DATA,
    vigenciaAte: DATA.nullish(),
    observacao: z.string().trim().max(300).nullish(),
  })
  .refine((d) => !d.vigenciaAte || d.vigenciaAte >= d.vigenciaDe, {
    message: "O fim da vigência não pode ser antes do início.",
    path: ["vigenciaAte"],
  });
export type CriarCustoFixoInput = z.infer<typeof CriarCustoFixoInput>;

/** Tipos de custo fixo que quase toda transportadora tem. Sugestão, não trava. */
export const TIPOS_CUSTO_FIXO = [
  "IPVA",
  "SEGURO",
  "FINANCIAMENTO",
  "DEPRECIACAO",
  "RASTREADOR",
  "LICENCIAMENTO",
  "OUTRO",
] as const;
