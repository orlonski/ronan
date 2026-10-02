import { z } from "zod";

/**
 * Ticket da viagem por e-mail pro cliente.
 *
 * Mora no cliente pagador (Empresa) e pode ser sobrescrito na obra (Cliente).
 * Nasce NENHUM: ninguém passa a receber e-mail sem alguém ligar no painel.
 */
export const MODOS_ENVIO_TICKET = ["NENHUM", "A_CADA_VIAGEM", "RESUMO_DIARIO"] as const;
export const ModoEnvioTicket = z.enum(MODOS_ENVIO_TICKET);
export type ModoEnvioTicket = z.infer<typeof ModoEnvioTicket>;

export const MODO_ENVIO_TICKET_LABEL: Record<ModoEnvioTicket, string> = {
  NENHUM: "Não enviar",
  A_CADA_VIAGEM: "A cada viagem aprovada",
  RESUMO_DIARIO: "Resumo do dia, às 19h",
};

/** Teto de destinatários: e-mail de ticket é pra quem confere, não lista de distribuição. */
export const MAX_EMAILS_TICKET = 10;

const EmailDestino = z.string().trim().toLowerCase().email("E-mail inválido.").max(160);

const ListaEmails = z
  .array(EmailDestino)
  .max(MAX_EMAILS_TICKET, `No máximo ${MAX_EMAILS_TICKET} e-mails.`)
  // Repetido não é erro de quem digitou — só sai uma vez.
  .transform((l) => [...new Set(l)]);

/**
 * Configuração salva pelo painel.
 *
 * `modo: null` só faz sentido na OBRA e quer dizer "segue o cliente pagador".
 * O pagador sempre tem um modo — a API recusa null pra ele.
 */
export const ConfigEnvioTicketInput = z
  .object({
    modo: ModoEnvioTicket.nullable(),
    emails: ListaEmails,
  })
  .superRefine((v, ctx) => {
    if (v.modo && v.modo !== "NENHUM" && v.emails.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["emails"],
        message: "Informe pelo menos um e-mail pra ligar o envio.",
      });
    }
  });
export type ConfigEnvioTicketInput = z.infer<typeof ConfigEnvioTicketInput>;

/** "Enviar teste": manda um exemplo pros e-mails que estão na tela (salvos ou não). */
export const EnviarTesteTicketInput = z.object({
  emails: ListaEmails.refine((l) => l.length > 0, "Informe pelo menos um e-mail."),
});
export type EnviarTesteTicketInput = z.infer<typeof EnviarTesteTicketInput>;

export type StatusEmailEnviado = "ENVIANDO" | "ENVIADO" | "FALHOU";

/** Uma linha do histórico curto mostrado no painel. */
export interface EmailEnviadoResumo {
  id: string;
  tipo: string;
  para: string[];
  assunto: string;
  status: StatusEmailEnviado;
  erro: string | null;
  criadoEm: string;
  enviadoEm: string | null;
}

/** O que o painel recebe ao abrir a configuração de um cliente/obra. */
export interface ConfigEnvioTicket {
  modo: ModoEnvioTicket | null;
  emails: string[];
  desde: string | null;
  /** Só na obra: o que vale de fato, considerando o pagador. */
  efetivo?: { modo: ModoEnvioTicket; emails: string[]; origem: "OBRA" | "PAGADOR" };
  /** O servidor tem SMTP configurado? Sem isso, nada sai — o painel avisa. */
  emailDisponivel: boolean;
  historico: EmailEnviadoResumo[];
}
