import { z } from "zod";

export const TIPOS_DOCUMENTO_MOTORISTA = [
  "CNH",
  "CRLV",
  "SEGURO_VEICULO",
  "REGISTRO_MOTORISTA",
  "ASO",
  "EPI",
  "ESOCIAL",
  "NR",
  "OS",
] as const;

export type TipoDocumentoMotorista = (typeof TIPOS_DOCUMENTO_MOTORISTA)[number];

export const TipoDocumentoMotoristaSchema = z.enum(TIPOS_DOCUMENTO_MOTORISTA);

export const ROTULO_DOCUMENTO_MOTORISTA: Record<TipoDocumentoMotorista, string> = {
  CNH: "CNH",
  CRLV: "Documento do veículo",
  SEGURO_VEICULO: "Seguro do veículo",
  REGISTRO_MOTORISTA: "Registro do motorista",
  ASO: "ASO",
  EPI: "EPI's",
  ESOCIAL: "eSocial",
  NR: "NR",
  OS: "OS",
};

export const MotoristaDocumentoOutput = z.object({
  id: z.string(),
  tipo: TipoDocumentoMotoristaSchema,
  nomeArquivo: z.string(),
  mimetype: z.string(),
  tamanho: z.number().int(),
  validade: z.string().nullable(),
  criadoEm: z.string(),
  alteradoEm: z.string(),
});
export type MotoristaDocumentoOutput = z.infer<typeof MotoristaDocumentoOutput>;

/**
 * Body do PATCH de validade. `validade` aceita "YYYY-MM-DD" ou null pra limpar.
 */
export const AtualizarValidadeDocumentoInput = z.object({
  validade: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD")
    .nullable(),
});
export type AtualizarValidadeDocumentoInput = z.infer<typeof AtualizarValidadeDocumentoInput>;
