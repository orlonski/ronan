import { z } from "zod";
import { cpfDigits } from "./cpf";
import { isTelefoneValid, telefoneDigits } from "./telefone";

// CPF leniente (igual ao login): só dígitos + 11 de comprimento, sem checar os
// verificadores. Mantém o erro genérico — não vaza se o CPF "existe" ou não.
const CpfLenienteSchema = z
  .string()
  .transform(cpfDigits)
  .refine((v) => v.length === 11, "CPF deve ter 11 dígitos");

// Telefone obrigatório (pra onde vai o código de reset). Normaliza pra dígitos.
const TelefoneResetSchema = z.preprocess(
  (v) => (typeof v === "string" ? telefoneDigits(v) : v),
  z.string().refine(isTelefoneValid, "Celular deve ter 10 ou 11 dígitos"),
);

export const LoginInput = z.object({
  email: z.string().email(),
  senha: z.string().min(6),
});
export type LoginInput = z.infer<typeof LoginInput>;

// Login do motorista: aceita CPF com ou sem máscara, normaliza pra dígitos.
// Aqui não validamos os dígitos verificadores pra não vazar info no erro
// (login com CPF inválido devolve "Credenciais inválidas" igual a senha errada).
export const LoginMotoristaInput = z.object({
  cpf: z
    .string()
    .transform(cpfDigits)
    .refine((v) => v.length === 11, "CPF deve ter 11 dígitos"),
  senha: z.string().min(6),
  /**
   * O app sabe lidar com quem não está em empresa nenhuma?
   *
   * Versão antiga não sabe: ela lê `accessToken` do topo da resposta e, sem
   * vínculo, não haveria token nenhum ali — ela guardaria `undefined` e ficaria
   * num limbo sem mensagem. Então quem não manda esta flag recebe um 403 que
   * explica o que fazer, em vez de uma tela quebrada.
   *
   * É explícito em vez de comparar versão de propósito: quem sabe lidar é quem
   * diz que sabe.
   */
  suportaIdentidade: z.boolean().optional(),
});
export type LoginMotoristaInput = z.infer<typeof LoginMotoristaInput>;

export const RefreshInput = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshInput = z.infer<typeof RefreshInput>;

export const TokensOutput = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type TokensOutput = z.infer<typeof TokensOutput>;

export const TrocarSenhaInput = z.object({
  senhaAtual: z.string().min(6),
  novaSenha: z.string().min(6),
});
export type TrocarSenhaInput = z.infer<typeof TrocarSenhaInput>;

// ---- Motorista em mais de uma empresa ----

/**
 * Um cadastro do motorista numa empresa. O mesmo CPF pode ter cadastro em várias
 * (ele carrega de dia pra uma e de noite pra outra) — são cadastros
 * INDEPENDENTES, cada um com seu id, e nada de um aparece no outro. O que eles
 * compartilham é só a senha, que é da pessoa e não do cadastro.
 *
 * O nome da empresa é a ÚNICA coisa que atravessa a fronteira: o motorista
 * precisa saber pra quem está lançando.
 */
export const CadastroEmpresa = z.object({
  motoristaId: z.string(),
  contaId: z.string(),
  contaNome: z.string(),
  status: z.enum(["PENDENTE_APROVACAO", "APROVADO", "REJEITADO"]),
});
export type CadastroEmpresa = z.infer<typeof CadastroEmpresa>;

/** Cadastro + o par de tokens dele (o app guarda uma sessão por empresa). */
export const SessaoEmpresa = CadastroEmpresa.extend({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type SessaoEmpresa = z.infer<typeof SessaoEmpresa>;

/**
 * A resposta do login.
 *
 * O formato antigo continua no TOPO (accessToken/refreshToken/status) pro app
 * que ainda não recebeu o OTA — ele lê exatamente esses campos e ignora o resto.
 * `identidade` é o par de tokens da PESSOA, que existe mesmo sem vínculo nenhum
 * e é o que dá acesso a `m/eu/*` (perfil, convites). Ver
 * docs/identidade-motorista.md.
 */
export const LoginMotoristaOutput = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  status: z.enum(["PENDENTE_APROVACAO", "APROVADO", "REJEITADO"]).optional(),
  cadastros: z.array(SessaoEmpresa),
  identidade: TokensOutput,
});
export type LoginMotoristaOutput = z.infer<typeof LoginMotoristaOutput>;

/**
 * Troca a empresa ativa sem pedir senha de novo. Só emite token pra cadastro do
 * MESMO CPF de quem está pedindo — a checagem mora no backend.
 */
export const TrocarEmpresaInput = z.object({
  motoristaId: z.string().uuid(),
});
export type TrocarEmpresaInput = z.infer<typeof TrocarEmpresaInput>;

/**
 * Painel: o operador da plataforma entra numa empresa pra dar suporte, ou volta
 * pra casa com `null`. Quem pode fazer isso é o backend que decide.
 *
 * Sem `.uuid()` de propósito — id de conta nem sempre é uuid (as primeiras
 * foram criadas com slug, tipo `cnt_schaba`).
 */
export const DefinirContaAtivaInput = z.object({
  contaId: z.string().min(1).nullable(),
});
export type DefinirContaAtivaInput = z.infer<typeof DefinirContaAtivaInput>;

// ---- Recuperação de senha do motorista (esqueci a senha) ----

/**
 * Passo 1: pede o código de redefinição. Informa CPF + celular.
 * - Se o CPF já tem celular cadastrado, o digitado precisa ser o MESMO.
 * - Se não tem celular cadastrado, o digitado é vinculado (após confirmar o
 *   código), desde que não pertença a outro CPF.
 * O código é sempre enviado pelo backend pro número de destino — nunca devolve
 * info que permita enumerar cadastros.
 */
export const EsqueciSenhaInput = z.object({
  cpf: CpfLenienteSchema,
  telefone: TelefoneResetSchema,
});
export type EsqueciSenhaInput = z.infer<typeof EsqueciSenhaInput>;

/** Reenvia o código de redefinição pro CPF (respeita cooldown/limites). */
export const ReenviarSenhaInput = z.object({
  cpf: CpfLenienteSchema,
});
export type ReenviarSenhaInput = z.infer<typeof ReenviarSenhaInput>;

/** Passo 2: confirma o código e define a nova senha. */
export const RedefinirSenhaInput = z.object({
  cpf: CpfLenienteSchema,
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Código deve ter 6 dígitos"),
  novaSenha: z.string().min(6, "Senha deve ter ao menos 6 caracteres").max(80),
});
export type RedefinirSenhaInput = z.infer<typeof RedefinirSenhaInput>;

export type AuthUser =
  | { kind: "ADMIN_USER"; id: string; nome: string; email: string }
  | { kind: "MOTORISTA"; id: string; nome: string; cpf: string };
