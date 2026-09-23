import { z } from "zod";
import { PapelEmpresa } from "./enums";
import { conferirCamposFiscais } from "./endereco-fiscal";

const CampoChaveMatch = z.enum(["placa", "data", "ticket"]);

/**
 * Os dados fiscais do cliente que paga — o tomador do CT-e.
 *
 * As colunas existiam no banco desde o começo, mas o schema não as declarava:
 * o Zod descartava o que o painel mandasse, o save respondia 200 e nada ficava
 * gravado. Os nomes seguem as colunas da tabela `empresas` (`razaoSocial`, não
 * o `razaoSocialFiscal` do local e da obra) porque o serviço grava o corpo
 * como veio. CNPJ continua no campo `cnpj` de sempre.
 */
const FiscalEmpresa = {
  razaoSocial: z.string().trim().max(60).optional().nullable(),
  inscricaoEstadual: z.string().trim().max(18).optional().nullable(),
  /** 1 contribuinte · 2 contribuinte isento · 9 não contribuinte. */
  indicadorIe: z.enum(["1", "2", "9"]).optional().nullable(),
  codigoMunicipioIbge: z
    .string()
    .trim()
    .regex(/^\d{7}$/, "O código IBGE tem 7 dígitos.")
    .optional()
    .nullable(),
  logradouro: z.string().trim().max(160).optional().nullable(),
  numeroEndereco: z.string().trim().max(20).optional().nullable(),
  bairro: z.string().trim().max(120).optional().nullable(),
  cep: z.string().trim().regex(/^\d{5}-?\d{3}$/, "CEP inválido.").optional().nullable(),
  municipio: z.string().trim().max(120).optional().nullable(),
  uf: z.string().trim().length(2).optional().nullable(),
  email: z.string().trim().email("E-mail inválido.").max(160).optional().nullable(),
};

// Sem o CNPJ na conferência: ele já tem a regra de formato acima, e passar a
// exigir dígito verificador agora travaria a edição de quem foi salvo antes.
const conferirFiscalEmpresa = (v: Partial<z.infer<z.ZodObject<typeof FiscalEmpresa>>>, ctx: z.RefinementCtx) =>
  conferirCamposFiscais(
    {
      indicadorIe: v.indicadorIe,
      inscricaoEstadual: v.inscricaoEstadual,
      codigoMunicipioIbge: v.codigoMunicipioIbge,
      uf: v.uf,
    },
    ctx,
  );

const EmpresaBase = z.object({
  nome: z.string().min(2).max(160),
  // CPF (11) ou CNPJ (14): empresa de dono autônomo/MEI muitas vezes só tem CPF.
  cnpj: z
    .string()
    .regex(/^(\d{11}|\d{14})$/, "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)")
    .optional(),
  contato: z.string().max(160).optional(),
  papel: z.nativeEnum(PapelEmpresa).default(PapelEmpresa.AMBOS),
  layoutImport: z.unknown().optional(),
  layoutExport: z.unknown().optional(),
  // Chave de match: lista de campos. Default null ⇒ ["placa","data","ticket"].
  chaveMatch: z.array(CampoChaveMatch).min(1).nullable().optional(),
  toleranciaKmPct: z.number().int().min(0).max(20).optional(),
  toleranciaTonPct: z.number().int().min(0).max(10).optional(),
  ...FiscalEmpresa,
});

export const CriarEmpresaInput = EmpresaBase.superRefine(conferirFiscalEmpresa);
export type CriarEmpresaInput = z.infer<typeof CriarEmpresaInput>;

export const AtualizarEmpresaInput = EmpresaBase.partial()
  .extend({ ativa: z.boolean().optional() })
  .superRefine(conferirFiscalEmpresa);
export type AtualizarEmpresaInput = z.infer<typeof AtualizarEmpresaInput>;

