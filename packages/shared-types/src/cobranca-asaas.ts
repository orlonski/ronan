import { z } from "zod";

/**
 * Cobrança do CLIENTE da transportadora pelo Asaas DELA.
 *
 * Não confundir com `assinaturas` (a Movatruck cobrando a mensalidade da
 * transportadora): aqui o dinheiro é da transportadora e cai na conta Asaas
 * própria dela, conectada pela chave de API que ela cola no painel.
 */

export const AMBIENTES_ASAAS = ["SANDBOX", "PRODUCAO"] as const;
export type AmbienteAsaasTipo = (typeof AMBIENTES_ASAAS)[number];

export const AMBIENTE_ASAAS_LABEL: Record<AmbienteAsaasTipo, string> = {
  SANDBOX: "Teste (sandbox)",
  PRODUCAO: "Produção (dinheiro de verdade)",
};

/**
 * O ambiente pela cara da chave.
 *
 * As chaves novas do Asaas trazem o ambiente no prefixo (`$aact_prod_…`,
 * `$aact_hmlg_…`). Chave antiga, sem marcador, devolve null — aí quem cola
 * escolhe. Adivinhar errado mandaria uma chave de produção pro sandbox (só não
 * funciona) ou, pior, trataria cobrança real como teste.
 */
export function detectarAmbienteAsaas(chave: string): AmbienteAsaasTipo | null {
  const c = chave.trim();
  if (c.startsWith("$aact_prod_")) return "PRODUCAO";
  if (c.startsWith("$aact_hmlg_")) return "SANDBOX";
  return null;
}

export const ConectarAsaasInput = z.object({
  chave: z
    .string()
    .trim()
    .min(20, "Essa chave está curta demais. Copie a chave inteira no Asaas, começando por $aact_.")
    .max(300)
    .refine((c) => !/\s/.test(c), "A chave não tem espaço no meio — confira se colou só ela."),
  /** Obrigatório só quando o prefixo da chave não diz o ambiente. */
  ambiente: z.enum(AMBIENTES_ASAAS).optional(),
});
export type ConectarAsaasInput = z.infer<typeof ConectarAsaasInput>;

export const STATUS_COBRANCA_CLIENTE = ["PENDENTE", "VENCIDA", "PAGA", "ESTORNADA", "CANCELADA"] as const;
export type StatusCobrancaClienteTipo = (typeof STATUS_COBRANCA_CLIENTE)[number];

export const STATUS_COBRANCA_CLIENTE_LABEL: Record<StatusCobrancaClienteTipo, string> = {
  PENDENTE: "Aguardando pagamento",
  VENCIDA: "Vencida, sem pagamento",
  PAGA: "Paga pelo Asaas",
  ESTORNADA: "Estornada",
  CANCELADA: "Cancelada",
};

/** O que a tela "Cobrança pelo Asaas" mostra. A chave em si nunca volta. */
export type ConexaoAsaasResumo = {
  conectada: boolean;
  ambiente?: AmbienteAsaasTipo;
  /** Só os 4 últimos caracteres. */
  chaveFinal?: string;
  nomeContaAsaas?: string | null;
  documentoContaAsaas?: string | null;
  webhookRegistrado?: boolean;
  webhookErro?: string | null;
  conectadoEm?: string;
  /** O servidor consegue guardar a chave cifrada e montar a URL do webhook? */
  disponivel: boolean;
  motivoIndisponivel?: string | null;
};
