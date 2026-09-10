import { z } from "zod";

/**
 * Auto-cadastro de EMPRESA pelo site: o transportador abre a conta dele sozinho
 * e começa o período de teste, sem passar por ninguém da Movatruck.
 *
 * O contrato é curto de propósito. Cada campo a mais no formulário derruba
 * cadastro, e o que não for essencial pode ser pedido depois, lá dentro, quando
 * a pessoa já viu o produto funcionando.
 */

/** Celular com DDD, só dígitos — é por ele que o código chega. */
const TelefoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ""))
  .refine((v) => v.length === 10 || v.length === 11, "Informe um celular com DDD.");

export const IniciarCadastroContaInput = z.object({
  empresa: z.string().trim().min(2, "Diga o nome da sua empresa.").max(120),
  /**
   * Opcional de propósito: pedir documento antes de mostrar valor é atrito puro.
   * Vira obrigatório quando a empresa deixa de ser teste.
   */
  cnpj: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 11 || v.length === 14, "CPF ou CNPJ inválido.")
    .optional(),
  adminNome: z.string().trim().min(2, "Diga seu nome.").max(120),
  adminEmail: z.string().trim().email("E-mail inválido.").max(160),
  telefone: TelefoneSchema,
  /** Mais longa que a do painel: esta porta é pública. */
  adminSenha: z.string().min(8, "A senha precisa de pelo menos 8 caracteres.").max(72),
  /**
   * Campo-armadilha: invisível na tela, então só robô preenche. Vem do mesmo
   * padrão do formulário de contato do site.
   */
  website: z.string().max(0).optional(),
});
export type IniciarCadastroContaInput = z.infer<typeof IniciarCadastroContaInput>;

export const ReenviarCodigoContaInput = z.object({ telefone: TelefoneSchema });
export type ReenviarCodigoContaInput = z.infer<typeof ReenviarCodigoContaInput>;

export const ConfirmarCadastroContaInput = z.object({
  telefone: TelefoneSchema,
  codigo: z.string().trim().regex(/^\d{6}$/, "O código tem 6 dígitos."),
});
export type ConfirmarCadastroContaInput = z.infer<typeof ConfirmarCadastroContaInput>;

/** O que o site mostra depois do `iniciar`. */
export type IniciarCadastroContaOutput = {
  ok: true;
  /** Quanto tempo o código vale. */
  expiraEmSegundos: number;
  /** Só os últimos dígitos — o suficiente pra pessoa conferir o número. */
  destinoMascarado: string;
};
