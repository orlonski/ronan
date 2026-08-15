import { z } from "zod";
import { cpfDigits, isCpfValid } from "./cpf";
import { isTelefoneValid, telefoneDigits } from "./telefone";

/**
 * Telefone OBRIGATÓRIO (usado no auto-cadastro: é pra esse número que vai o
 * código de verificação por WhatsApp). Normaliza pra dígitos puros.
 */
const TelefoneObrigatorioSchema = z.preprocess(
  (v) => (typeof v === "string" ? telefoneDigits(v) : v),
  z.string().refine(isTelefoneValid, "Celular deve ter 10 ou 11 dígitos"),
);

/**
 * Aceita CPF com ou sem máscara, normaliza pra 11 dígitos e valida pelos
 * dígitos verificadores. Saída sempre = 11 dígitos puros.
 */
const CpfSchema = z
  .string()
  .transform(cpfDigits)
  .refine((v) => v.length === 11, "CPF deve ter 11 dígitos")
  .refine((v) => isCpfValid(v), "CPF inválido");

/**
 * Telefone opcional. Aceita com ou sem máscara, normaliza pra dígitos puros.
 * Strings vazias viram undefined.
 */
const TelefoneOpcionalSchema = z
  .preprocess(
    (v) => {
      if (typeof v !== "string") return v;
      const d = telefoneDigits(v);
      return d === "" ? undefined : d;
    },
    z.string().refine(isTelefoneValid, "Telefone deve ter 10 ou 11 dígitos").optional(),
  );

/**
 * Email opcional. Trim, lowercase. String vazia vira undefined.
 */
const EmailOpcionalSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" ? undefined : t.toLowerCase();
  },
  z.string().email("Email inválido").optional(),
);

const placaRegex = /^[A-Z]{3}-?\d[A-Z\d]\d{2}$/i;

/**
 * Placa vinculada ao motorista. Backend faz upsert: se placa existe, vincula
 * (e atualiza modelo se vier); se não existe, cria veículo novo e vincula.
 * Placa é única por veículo (mas pode estar em vários motoristas via N:N).
 */
const PlacaInput = z.object({
  placa: z
    .string()
    .trim()
    .toUpperCase()
    .regex(placaRegex, "Placa inválida (formato Mercosul: ABC1D23 ou antigo: ABC1234)"),
  modelo: z.string().max(80).optional(),
});
export type PlacaInput = z.infer<typeof PlacaInput>;

/**
 * Garante que não tem placas duplicadas no array (mesma placa repetida no form).
 */
function placasSemDuplicatas(placas: PlacaInput[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  for (let i = 0; i < placas.length; i++) {
    const p = placas[i]!.placa;
    if (seen.has(p)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placas", i, "placa"],
        message: "Placa repetida",
      });
    }
    seen.add(p);
  }
}

export const CriarMotoristaInput = z
  .object({
    nome: z.string().min(2).max(120),
    cpf: CpfSchema,
    /**
     * Opcional de propósito: se o CPF já tem cadastro em outra empresa, a senha
     * dele já existe (é da pessoa, não do cadastro) e o painel nem mostra o
     * campo. Quem cobra a senha quando ela é mesmo necessária é o backend — a
     * checagem "já existe em outra empresa" atravessa contas e não pode morar
     * num schema que roda no navegador.
     */
    senha: z.string().min(6).max(80).optional(),
    telefone: TelefoneOpcionalSchema,
    email: EmailOpcionalSchema,
    placas: z.array(PlacaInput).default([]),
    /** Frota dona do motorista. Null = não classificado. */
    transportadoraId: z.string().uuid().nullish(),
  // Vínculo (próprio/agregado/terceiro). Só o painel web define.
  modalidadeId: z.string().uuid().nullish(),
    /** Placa default — string (não id). Backend resolve pro id após upsert. */
    placaDefault: z
      .string()
      .trim()
      .toUpperCase()
      .regex(placaRegex)
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    placasSemDuplicatas(v.placas, ctx);
    if (v.placaDefault && !v.placas.some((p) => p.placa === v.placaDefault)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placaDefault"],
        message: "Placa padrão precisa estar na lista de placas",
      });
    }
  });
export type CriarMotoristaInput = z.infer<typeof CriarMotoristaInput>;

export const AtualizarMotoristaInput = z
  .object({
    nome: z.string().min(2).max(120).optional(),
    cpf: CpfSchema.optional(),
    telefone: TelefoneOpcionalSchema,
    email: EmailOpcionalSchema,
    placas: z.array(PlacaInput).optional(),
    transportadoraId: z.string().uuid().nullish(),
  // Vínculo (próprio/agregado/terceiro). Só o painel web define.
  modalidadeId: z.string().uuid().nullish(),
    placaDefault: z
      .string()
      .trim()
      .toUpperCase()
      .regex(placaRegex)
      .nullable()
      .optional(),
    ativo: z.boolean().optional(),
    novaSenha: z.string().min(6).max(80).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.placas) placasSemDuplicatas(v.placas, ctx);
    if (v.placaDefault && v.placas && !v.placas.some((p) => p.placa === v.placaDefault)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placaDefault"],
        message: "Placa padrão precisa estar na lista de placas",
      });
    }
  });
export type AtualizarMotoristaInput = z.infer<typeof AtualizarMotoristaInput>;

/**
 * Auto-cadastro feito pelo próprio motorista no app (pré-login). Diferente do
 * CriarMotoristaInput (admin): celular é OBRIGATÓRIO (recebe o código por
 * WhatsApp) e exige ao menos uma placa. A senha é definida pelo motorista.
 */
/**
 * Código que a empresa dá ao motorista (ex.: `FREITAS-K9M4TX`). É o que diz em
 * qual empresa o cadastro entra — o app das lojas é um só e não tem como saber.
 * Aceita com ou sem hífen, em qualquer caixa: o backend normaliza.
 */
export const CodigoEmpresaSchema = z
  .string()
  .trim()
  .min(3, "Digite o código da empresa")
  .max(40)
  .transform((s) => s.toUpperCase().replace(/\s+/g, ""));

export const CadastroMotoristaInput = z
  .object({
    codigoEmpresa: CodigoEmpresaSchema,
    nome: z.string().min(2, "Nome muito curto").max(120),
    cpf: CpfSchema,
    telefone: TelefoneObrigatorioSchema,
    email: EmailOpcionalSchema,
    senha: z.string().min(6, "Senha deve ter ao menos 6 caracteres").max(80),
    placas: z.array(PlacaInput).min(1, "Informe ao menos uma placa"),
    /** Placa default — string (não id). Backend resolve pro id após upsert. */
    placaDefault: z
      .string()
      .trim()
      .toUpperCase()
      .regex(placaRegex)
      .nullable()
      .optional(),
  })
  .superRefine((v, ctx) => {
    placasSemDuplicatas(v.placas, ctx);
    if (v.placaDefault && !v.placas.some((p) => p.placa === v.placaDefault)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["placaDefault"],
        message: "Placa padrão precisa estar na lista de placas",
      });
    }
  });
export type CadastroMotoristaInput = z.infer<typeof CadastroMotoristaInput>;

/** Confirma o código de 6 dígitos enviado por WhatsApp e finaliza o cadastro. */
export const ConfirmarCadastroInput = z.object({
  codigoEmpresa: CodigoEmpresaSchema,
  cpf: CpfSchema,
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Código deve ter 6 dígitos"),
});
export type ConfirmarCadastroInput = z.infer<typeof ConfirmarCadastroInput>;

/** Reenvia o código de verificação pro cadastro pendente daquele CPF. */
export const ReenviarCodigoInput = z.object({
  codigoEmpresa: CodigoEmpresaSchema,
  cpf: CpfSchema,
});
export type ReenviarCodigoInput = z.infer<typeof ReenviarCodigoInput>;

/** Admin aprova ou rejeita um cadastro pendente. */
export const AprovarMotoristaInput = z.object({
  status: z.enum(["APROVADO", "REJEITADO"]),
});
export type AprovarMotoristaInput = z.infer<typeof AprovarMotoristaInput>;
