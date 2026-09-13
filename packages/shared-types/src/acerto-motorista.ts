import { z } from "zod";

/**
 * O acerto do período com o motorista — o extrato que ele confere e assina.
 */

export const TIPOS_ITEM_ACERTO = [
  "FRETE",
  "DIARIA",
  "REEMBOLSO_PEDAGIO",
  "REEMBOLSO_ABASTECIMENTO",
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
  DIARIA: "Diária",
  REEMBOLSO_PEDAGIO: "Pedágio que você pagou",
  REEMBOLSO_ABASTECIMENTO: "Abastecimento que você pagou",
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

/** A régua de pagamento, usada no cadastro de modalidade e de motorista. */
export const RemuneracaoInput = z.object({
  tipoRemuneracao: TipoRemuneracaoSchema.nullish(),
  percentualFrete: z.number().positive().max(100).nullish(),
  valorPorViagem: z.number().positive().max(99999.99).nullish(),
  valorPorTonelada: z.number().positive().max(99999.99).nullish(),
  valorPorKm: z.number().positive().max(99999.99).nullish(),
  valorDiaria: z.number().positive().max(99999.99).nullish(),
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
