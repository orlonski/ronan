import { z } from "zod";

/**
 * O acerto do período com o motorista — o extrato que ele confere e assina.
 */

export const TIPOS_ITEM_ACERTO = [
  "FRETE",
  "REEMBOLSO_PEDAGIO",
  "REEMBOLSO_ABASTECIMENTO",
  "REEMBOLSO_DESPESA",
  "ADIANTAMENTO",
  "DESCONTO_AVARIA",
  "DESCONTO_MULTA",
  "DESCONTO_COMBUSTIVEL",
  "DESCONTO_OUTROS",
  "BONUS",
  "AJUSTE",
] as const;
export const TipoItemAcertoSchema = z.enum(TIPOS_ITEM_ACERTO);
export type TipoItemAcertoTipo = z.infer<typeof TipoItemAcertoSchema>;

/** Os tipos que o painel pode LANÇAR à mão. Os automáticos a regra gera. */
export const TIPOS_ITEM_MANUAL = [
  "ADIANTAMENTO",
  "DESCONTO_AVARIA",
  "DESCONTO_MULTA",
  "DESCONTO_COMBUSTIVEL",
  "DESCONTO_OUTROS",
  "BONUS",
  "AJUSTE",
] as const;

/** Quais descontam. O painel usa pra saber que o valor entra negativo. */
export const TIPOS_DEBITO_ACERTO = [
  "ADIANTAMENTO",
  "DESCONTO_AVARIA",
  "DESCONTO_MULTA",
  "DESCONTO_COMBUSTIVEL",
  "DESCONTO_OUTROS",
] as const;

export const ITEM_ACERTO_LABEL: Record<TipoItemAcertoTipo, string> = {
  FRETE: "Frete da viagem",
  REEMBOLSO_PEDAGIO: "Pedágio que você pagou",
  REEMBOLSO_ABASTECIMENTO: "Abastecimento que você pagou",
  REEMBOLSO_DESPESA: "Reembolso de gastos",
  ADIANTAMENTO: "Adiantamento já recebido",
  DESCONTO_AVARIA: "Desconto por avaria",
  DESCONTO_MULTA: "Desconto de multa",
  DESCONTO_COMBUSTIVEL: "Desconto de combustível",
  DESCONTO_OUTROS: "Outro desconto",
  BONUS: "Bônus",
  AJUSTE: "Ajuste",
};

export const TIPOS_REMUNERACAO = [
  "SEM_REMUNERACAO",
  "PERCENTUAL_FRETE",
  "VALOR_POR_VIAGEM",
  "VALOR_POR_TONELADA",
  "VALOR_POR_KM",
] as const;
export const TipoRemuneracaoSchema = z.enum(TIPOS_REMUNERACAO);
export type TipoRemuneracaoTipo = z.infer<typeof TipoRemuneracaoSchema>;

export const REMUNERACAO_LABEL: Record<TipoRemuneracaoTipo, { nome: string; campo: string | null }> = {
  SEM_REMUNERACAO: { nome: "Não é pago por viagem aqui", campo: null },
  PERCENTUAL_FRETE: { nome: "Porcentagem do frete", campo: "percentualFrete" },
  VALOR_POR_VIAGEM: { nome: "Valor fixo por viagem", campo: "valorPorViagem" },
  VALOR_POR_TONELADA: { nome: "Valor por tonelada", campo: "valorPorTonelada" },
  VALOR_POR_KM: { nome: "Valor por quilômetro", campo: "valorPorKm" },
};

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");

/**
 * Gera (ou regenera) o acerto de um motorista num período.
 *
 * Regenerar é seguro: só os itens AUTOMÁTICOS são refeitos. O que foi lançado à
 * mão (adiantamento, desconto) sobrevive — senão o operador perderia o trabalho
 * dele toda vez que uma viagem nova entrasse no período.
 */
export const GerarAcertoInput = z
  .object({
    motoristaId: z.string().uuid(),
    periodoInicio: DATA,
    periodoFim: DATA,
  })
  .refine((d) => d.periodoFim >= d.periodoInicio, {
    message: "O fim do período não pode ser antes do início.",
    path: ["periodoFim"],
  });
export type GerarAcertoInput = z.infer<typeof GerarAcertoInput>;

/** Gera pra frota inteira de uma vez — é como o fechamento do mês acontece. */
export const GerarAcertosEmLoteInput = z
  .object({
    periodoInicio: DATA,
    periodoFim: DATA,
    /** Vazio = todos os motoristas ativos com remuneração configurada. */
    motoristaIds: z.array(z.string().uuid()).optional(),
  })
  .refine((d) => d.periodoFim >= d.periodoInicio, {
    message: "O fim do período não pode ser antes do início.",
    path: ["periodoFim"],
  });
export type GerarAcertosEmLoteInput = z.infer<typeof GerarAcertosEmLoteInput>;

export const AdicionarItemAcertoInput = z
  .object({
    tipo: z.enum(TIPOS_ITEM_MANUAL),
    /** Sempre POSITIVO. O backend aplica o sinal conforme o tipo. */
    valor: z.number().positive().max(9999999.99),
    descricao: z.string().trim().min(3, "Escreva o que é."),
    motivo: z.string().trim().max(500).optional(),
  })
  .refine(
    (d) =>
      !(TIPOS_DEBITO_ACERTO as readonly string[]).includes(d.tipo) ||
      (d.motivo != null && d.motivo.length >= 10),
    {
      // Tirar dinheiro de parceiro autônomo sem justificativa escrita é a mesma
      // doutrina do km: não pode. Bônus e ajuste positivo não exigem.
      message: "Desconto exige motivo escrito (pelo menos 10 letras).",
      path: ["motivo"],
    },
  );
export type AdicionarItemAcertoInput = z.infer<typeof AdicionarItemAcertoInput>;

export const MarcarAcertoPagoInput = z.object({
  pagoEm: DATA.optional(),
  meio: z.string().trim().min(2).max(40).default("PIX"),
  observacao: z.string().trim().max(500).optional(),
});
export type MarcarAcertoPagoInput = z.infer<typeof MarcarAcertoPagoInput>;

/**
 * Descarta um acerto ABERTO gerado errado (período trocado, lote rodado no mês
 * errado). Solta os itens pra outro acerto pegar. FECHADO/PAGO não descarta.
 */
export const DescartarAcertoInput = z.object({
  motivo: z.string().trim().min(10, "Escreva o motivo (pelo menos 10 letras).").max(500),
});
export type DescartarAcertoInput = z.infer<typeof DescartarAcertoInput>;

/** A empresa marcou, na lista "Ficou de fora", o que entra neste acerto. */
export const IncluirDeForaAcertoInput = z.object({
  chaves: z.array(z.string().min(3).max(120)).min(1, "Marque pelo menos um lançamento.").max(500),
});
export type IncluirDeForaAcertoInput = z.infer<typeof IncluirDeForaAcertoInput>;

export const DECISOES_PEDAGIO_DOBRO = ["MESMO_PEDAGIO", "PEDAGIOS_DIFERENTES"] as const;
export type DecisaoPedagioDobro = (typeof DECISOES_PEDAGIO_DOBRO)[number];

/** "É o mesmo pedágio" (o avulso sai deste acerto) ou "são pedágios diferentes". */
export const DecidirPedagioDobroInput = z.object({
  pedagioId: z.string().uuid(),
  viagemId: z.string().uuid().optional(),
  decisao: z.enum(DECISOES_PEDAGIO_DOBRO),
});
export type DecidirPedagioDobroInput = z.infer<typeof DecidirPedagioDobroInput>;

/**
 * Conferência da tag: quanto a empresa devolve do pedágio que o motorista lançou
 * numa viagem em que a tag (ou o vale) pagou passagens. Valor diferente da
 * sugestão exige motivo escrito — é dinheiro de parceiro autônomo.
 */
export const DecidirPedagioTagInput = z.object({
  viagemId: z.string().uuid(),
  valorReembolso: z.number().min(0).max(999999.99),
  motivo: z.string().trim().max(500).optional(),
});
export type DecidirPedagioTagInput = z.infer<typeof DecidirPedagioTagInput>;

/** Uma viagem com pedágio lançado e passagens da tag ligadas a ela. */
export type ViagemConferenciaTag = {
  viagemId: string;
  dia: string;
  rota: string | null;
  /** O que o motorista lançou de pedágio na viagem. */
  lancado: string;
  /** Tag e vale nas passagens ligadas à viagem. */
  tag: string;
  vale: string;
  /** A volta vazia ligada à viagem passou isto na tag. Fora da sugestão. */
  retorno: string;
  /**
   * O que sugerir devolver: a diferença (lançado − tag − vale da ida) SÓ quando a
   * rota tem praça que a tag não registrou; senão zero — diferença sem prova.
   */
  sugestao: string;
  /** Lançado − tag − vale da ida, nunca negativo (com ou sem prova). */
  diferenca: string;
  /** Praças da rota sem passagem na tag (onde ele pode ter pago em dinheiro). null = rota desconhecida. */
  pracasSemPassagem: string[] | null;
  /** Valor do reembolso desta viagem NESTE acerto (null = não está aqui). */
  noAcerto: string | null;
  /** Já reembolsado num acerto fechado: a decisão vira ajuste neste. */
  jaPago: { valor: string; acerto: string } | null;
  decisao: {
    valorReembolso: string;
    motivo: string | null;
    decididoPor: string | null;
    decididoEm: string;
  } | null;
  /** O ajuste desta decisão já está num acerto fechado: não muda mais. */
  travada: boolean;
};

/** O que a tela do acerto precisa conferir antes de fechar. Só leitura. */
export type ConferenciaDoAcerto = {
  /** Possível pedágio em dobro, por dia. */
  pedagioEmDobro: Array<{
    dia: string;
    viagens: Array<{ itemId: string; viagemId: string; valor: string; descricao: string }>;
    avulsos: Array<{
      itemId: string;
      pedagioId: string;
      valor: string;
      descricao: string;
      decisao: {
        decisao: DecisaoPedagioDobro;
        decididoPor: string | null;
        decididoEm: string;
      } | null;
    }>;
    totalViagens: string;
    totalAvulsos: string;
    pendentes: number;
  }>;
  /** Avulsos que a empresa disse ser o mesmo pedágio da viagem: saíram deste acerto. */
  pedagiosTirados: Array<{
    pedagioId: string;
    descricao: string;
    valor: string;
    decididoPor: string | null;
    decididoEm: string;
  }>;
  /** Item de reembolso de abastecimento que casa com passada no cartão da empresa. */
  pagoNoCartao: Array<{
    itemId: string;
    abastecimentoId: string;
    transacao: { data: string; valor: number; posto: string | null; placa: string | null };
  }>;
  /** Lançamentos com data anterior ao período que não estão em acerto nenhum. */
  ficouDeFora: Array<{
    chave: string;
    tipo: TipoItemAcertoTipo;
    descricao: string;
    valor: string;
    data: string;
  }>;
  /**
   * Pedágio lançado × o que a tag pagou (módulo `tag-pedagio`). null = a conta
   * não tem o módulo, ou a régua do motorista não devolve pedágio.
   */
  pedagioTag: {
    viagens: ViagemConferenciaTag[];
    /** Viagens com pedágio lançado em caminhão com tag cuja fatura do dia ainda não chegou. */
    faturaNaoChegou: number;
    /** A fatura cobre o dia, mas nenhuma passagem foi ligada à viagem. */
    naoCasadas: number;
  } | null;
};

/** A régua de pagamento, usada no cadastro de modalidade e de motorista. */
export const RemuneracaoInput = z.object({
  tipoRemuneracao: TipoRemuneracaoSchema.nullish(),
  percentualFrete: z.number().positive().max(100).nullish(),
  valorPorViagem: z.number().positive().max(99999.99).nullish(),
  valorPorTonelada: z.number().positive().max(99999.99).nullish(),
  valorPorKm: z.number().positive().max(99999.99).nullish(),
});
export type RemuneracaoInput = z.infer<typeof RemuneracaoInput>;

/** O extrato como o motorista vê no app. */
export type AcertoDoMotorista = {
  id: string;
  periodoInicio: string;
  periodoFim: string;
  status: "ABERTO" | "FECHADO" | "PAGO";
  creditos: string;
  debitos: string;
  liquido: string;
  pagoEm: string | null;
  pagoMeio: string | null;
  observacao: string | null;
  itens: Array<{
    id: string;
    tipo: TipoItemAcertoTipo;
    descricao: string;
    valor: string;
    motivo: string | null;
  }>;
};
