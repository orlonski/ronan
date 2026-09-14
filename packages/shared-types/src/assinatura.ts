import { z } from "zod";

/**
 * A ASSINATURA: o que a empresa cliente paga pra usar a Movatruck.
 *
 * Não confundir com nada do dia a dia da transportadora. `TabelaPreco` é quanto
 * a transportadora cobra do tomador dela; `Fatura`/`Titulo` são o financeiro
 * dela. Aqui é o outro lado do balcão — a mensalidade que a Movatruck cobra
 * DELA, e que até 14/09/2026 era Pix na mão, sem cobrança gerada, sem nota e
 * sem histórico.
 *
 * A régua comercial mora em `FaixaPreco` (preço por tamanho de frota) e é dela
 * que sai o valor sugerido. O valor da assinatura é COPIADO na hora de criar,
 * nunca lido ao vivo: reajuste de tabela não pode mudar sozinho o que um
 * cliente combinou pagar.
 */

/**
 * Por onde o dinheiro entra.
 *
 * A ordem aqui é a ordem da preferência comercial, e o motivo é taxa: sobre
 * R$ 1.890, o Pix custa R$ 1,99 fixo e o cartão custa R$ 0,49 + 2,99% = R$ 57.
 * É 28x mais caro receber a MESMA mensalidade pelo cartão.
 *
 * - `PIX_AUTOMATICO` — o padrão. O cliente autoriza uma vez no app do banco e
 *   as parcelas seguintes caem sozinhas, sem ele fazer nada. É a recorrência
 *   do Pix (Banco Central), não um lembrete com QR Code.
 * - `CARTAO` — assinatura recorrente. Cobra só a mensalidade a cada mês, ao
 *   contrário de parcelar o ano, que travaria o limite inteiro de uma vez.
 * - `PIX` — QR Code avulso todo mês, que alguém precisa pagar na mão. É o que
 *   os dois primeiros clientes faziam, e continua existindo pra quem tem banco
 *   sem Pix Automático.
 * - `BOLETO` — mesma taxa do Pix, e alguns financeiros só pagam assim.
 */
export const FORMAS_COBRANCA = ["PIX_AUTOMATICO", "CARTAO", "PIX", "BOLETO"] as const;
export const FormaCobrancaSchema = z.enum(FORMAS_COBRANCA);
export type FormaCobranca = z.infer<typeof FormaCobrancaSchema>;

export const ROTULO_FORMA_COBRANCA: Record<FormaCobranca, string> = {
  PIX_AUTOMATICO: "Pix Automático",
  CARTAO: "Cartão recorrente",
  PIX: "Pix mês a mês",
  BOLETO: "Boleto",
};

/**
 * Quanto custa receber por cada forma, em cima de um valor.
 *
 * Mora aqui, e não numa planilha, porque é o número que decide a conversa
 * comercial: mostrar na tela que o cartão come R$ 57 por mês é o que faz o
 * Pix Automático ser oferecido primeiro. São as taxas públicas do Asaas e
 * envelhecem — quando mudarem, muda aqui e a tela inteira acompanha.
 */
export const TAXA_GATEWAY: Record<FormaCobranca, { fixaCentavos: number; percentual: number }> = {
  PIX_AUTOMATICO: { fixaCentavos: 199, percentual: 0 },
  PIX: { fixaCentavos: 199, percentual: 0 },
  BOLETO: { fixaCentavos: 199, percentual: 0 },
  CARTAO: { fixaCentavos: 49, percentual: 0.0299 },
};

/** Quanto a plataforma perde de taxa ao receber `valorCentavos` por essa forma. */
export function custoDeReceber(forma: FormaCobranca, valorCentavos: number): number {
  const taxa = TAXA_GATEWAY[forma];
  return taxa.fixaCentavos + Math.round(valorCentavos * taxa.percentual);
}

/**
 * Em que pé está a assinatura.
 *
 * `AGUARDANDO` é o estado que só existe por causa da autorização: no Pix
 * Automático e no cartão, criar a assinatura no gateway não basta — o cliente
 * precisa autorizar (QR Code do primeiro pagamento, ou o cartão passar). Até
 * lá não há o que cobrar, e chamar isso de "ativa" faria a tela mentir.
 */
export const STATUS_ASSINATURA = [
  "RASCUNHO",
  "AGUARDANDO",
  "ATIVA",
  "INADIMPLENTE",
  "CANCELADA",
] as const;
export const StatusAssinaturaSchema = z.enum(STATUS_ASSINATURA);
export type StatusAssinatura = z.infer<typeof StatusAssinaturaSchema>;

export const ROTULO_STATUS_ASSINATURA: Record<StatusAssinatura, string> = {
  RASCUNHO: "Rascunho",
  AGUARDANDO: "Aguardando autorização",
  ATIVA: "Ativa",
  INADIMPLENTE: "Em atraso",
  CANCELADA: "Cancelada",
};

/**
 * Em que pé está UMA cobrança.
 *
 * `CONFIRMADA` e `RECEBIDA` são dois eventos diferentes do gateway e a
 * diferença é real: confirmada é "o pagamento aconteceu", recebida é "o
 * dinheiro está disponível". Pro cliente as duas significam pago — e é por
 * `CONFIRMADA` que a régua para de cobrar, porque esperar o saldo liberar
 * cobraria de novo quem já pagou.
 */
export const STATUS_COBRANCA = [
  "PENDENTE",
  "CONFIRMADA",
  "RECEBIDA",
  "VENCIDA",
  "ESTORNADA",
  "CANCELADA",
] as const;
export const StatusCobrancaSchema = z.enum(STATUS_COBRANCA);
export type StatusCobranca = z.infer<typeof StatusCobrancaSchema>;

export const ROTULO_STATUS_COBRANCA: Record<StatusCobranca, string> = {
  PENDENTE: "Em aberto",
  CONFIRMADA: "Paga",
  RECEBIDA: "Paga",
  VENCIDA: "Vencida",
  ESTORNADA: "Estornada",
  CANCELADA: "Cancelada",
};

/** Pago é pago: as duas contam como quitada, e nenhuma régua cobra de novo. */
export const STATUS_COBRANCA_PAGA: StatusCobranca[] = ["CONFIRMADA", "RECEBIDA"];

/** Cobranças que ainda esperam dinheiro — é o que a régua olha. */
export const STATUS_COBRANCA_ABERTA: StatusCobranca[] = ["PENDENTE", "VENCIDA"];

export const CICLOS_ASSINATURA = ["MENSAL", "ANUAL"] as const;
export const CicloAssinaturaSchema = z.enum(CICLOS_ASSINATURA);
export type CicloAssinatura = z.infer<typeof CicloAssinaturaSchema>;

export const ROTULO_CICLO: Record<CicloAssinatura, string> = {
  MENSAL: "Mensal",
  ANUAL: "Anual",
};

/**
 * Dia do vencimento. Para em 28 de propósito: 29, 30 e 31 não existem em todo
 * mês, e "vence dia 31" vira uma regra de arredondamento que ninguém combinou.
 */
const DiaVencimento = z
  .number()
  .int()
  .min(1, "O vencimento cai entre os dias 1 e 28.")
  .max(28, "O vencimento cai entre os dias 1 e 28 — fevereiro não tem dia 30.");

/** Só dígitos, CPF (11) ou CNPJ (14). Quem emite nota precisa disso certo. */
const Documento = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => v.length === 11 || v.length === 14, "Informe um CPF (11) ou CNPJ (14 dígitos).");

export const CriarAssinaturaInput = z.object({
  contaId: z.string().uuid("Diga de qual empresa é a assinatura."),
  forma: FormaCobrancaSchema,
  ciclo: CicloAssinaturaSchema.default("MENSAL"),
  /**
   * O valor combinado, em centavos. Vem sugerido da `FaixaPreco` pelo tamanho
   * da frota, mas é editável: desconto de fundador, condição de migração e
   * preço congelado são conversas que acontecem e precisam caber aqui.
   */
  valorCentavos: z.number().int().min(100, "O valor precisa ser maior que R$ 1,00."),
  diaVencimento: DiaVencimento.default(10),
  /** Primeira competência a cobrar. Vazio = o mês que vem. */
  primeiroVencimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.")
    .optional(),
  /** Quem recebe a cobrança. É o financeiro da empresa, que raramente é o dono. */
  nomeResponsavel: z.string().trim().min(2, "Diga o nome de quem recebe a cobrança."),
  emailCobranca: z.string().trim().email("E-mail inválido."),
  telefoneCobranca: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length >= 10 && v.length <= 13, "Telefone com DDD."),
  documento: Documento,
  observacao: z.string().trim().max(500).optional(),
  /**
   * Avisar o cliente por WhatsApp assim que a assinatura for criada.
   *
   * Ligado por padrão: o normal é que ele precise do código pra autorizar, e
   * esperar alguém lembrar de mandar é como uma assinatura fica parada. Existe
   * a opção de desligar porque há o caso real de ligar pro cliente antes — e um
   * sistema que não deixa escolher isso vira um sistema contornado por fora.
   */
  avisarCliente: z.boolean().default(true),
});
export type CriarAssinaturaInput = z.infer<typeof CriarAssinaturaInput>;

export const AtualizarAssinaturaInput = z.object({
  valorCentavos: z.number().int().min(100).optional(),
  diaVencimento: DiaVencimento.optional(),
  nomeResponsavel: z.string().trim().min(2).optional(),
  emailCobranca: z.string().trim().email().optional(),
  telefoneCobranca: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length >= 10 && v.length <= 13, "Telefone com DDD.")
    .optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
});
export type AtualizarAssinaturaInput = z.infer<typeof AtualizarAssinaturaInput>;

/**
 * Cancelar exige motivo escrito.
 *
 * Mesma régua do `checarAlteracaoKm`: o que mexe em dinheiro e não dá pra
 * desfazer sozinho precisa deixar dito por quê. Daqui a seis meses, "por que
 * essa empresa parou de pagar?" tem que ter resposta no próprio registro.
 */
export const CancelarAssinaturaInput = z.object({
  motivo: z.string().trim().min(5, "Escreva por que a assinatura está sendo cancelada."),
});
export type CancelarAssinaturaInput = z.infer<typeof CancelarAssinaturaInput>;

/**
 * Baixa manual: o dinheiro entrou por fora do gateway.
 *
 * Existe porque o primeiro mês de qualquer cliente migrado entra assim — ele
 * pagou no Pix da conta, na mão, antes da assinatura existir. Sem isto, a
 * cobrança ficaria vencida pra sempre e a régua cobraria alguém que já pagou.
 */
export const BaixaManualInput = z.object({
  pagoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD."),
  valorCentavos: z.number().int().min(1).optional(),
  motivo: z.string().trim().min(5, "Escreva como esse pagamento entrou (Pix na conta, TED…)."),
});
export type BaixaManualInput = z.infer<typeof BaixaManualInput>;
