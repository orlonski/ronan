import { z } from "zod";

/**
 * Transportadora = a frota dona dos caminhões e dos motoristas. A Schaba é uma;
 * as frotas terceiras que rodam pra ela são outras.
 *
 * NÃO confundir com Empresa (`empresa.ts`), que é o tomador de serviço — quem
 * manda planilha de fechamento e recebe as viagens.
 */
export const CriarTransportadoraInput = z.object({
  nome: z.string().trim().min(2).max(160),
  // CPF (11) ou CNPJ (14): transportadora de dono autônomo/MEI muitas vezes só tem CPF.
  cnpj: z
    .string()
    .regex(/^(\d{11}|\d{14})$/, "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)")
    .optional(),
  contato: z.string().max(160).optional(),
});
export type CriarTransportadoraInput = z.infer<typeof CriarTransportadoraInput>;

export const AtualizarTransportadoraInput = CriarTransportadoraInput.partial().extend({
  ativa: z.boolean().optional(),
});
export type AtualizarTransportadoraInput = z.infer<typeof AtualizarTransportadoraInput>;
