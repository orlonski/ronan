import { z } from "zod";

// Ordem dos tipos = ordem alfabética pelo rótulo em PT-BR. A UI itera essa
// lista pra montar a tela de documentos, então mudar ordem aqui já reordena
// no dashboard sem precisar de sort em cada lugar.
export const TIPOS_DOCUMENTO_MOTORISTA = [
  "ASO",
  "CNH",
  "COMODATO",
  "CRLV",
  "EPI",
  "ESOCIAL",
  "LAUDO_TECNICO",
  "NR",
  "OS",
  "PLANO_MANUTENCAO",
  "REGISTRO_MOTORISTA",
  "SEGURO_VEICULO",
] as const;

export type TipoDocumentoMotorista = (typeof TIPOS_DOCUMENTO_MOTORISTA)[number];

export const TipoDocumentoMotoristaSchema = z.enum(TIPOS_DOCUMENTO_MOTORISTA);

export const ROTULO_DOCUMENTO_MOTORISTA: Record<TipoDocumentoMotorista, string> = {
  ASO: "ASO",
  CNH: "CNH",
  COMODATO: "Comodato",
  CRLV: "Documento do veículo",
  EPI: "EPI's",
  ESOCIAL: "eSocial",
  LAUDO_TECNICO: "Laudo técnico",
  NR: "NR",
  OS: "OS",
  PLANO_MANUTENCAO: "Plano de manutenção",
  REGISTRO_MOTORISTA: "Registro do motorista",
  SEGURO_VEICULO: "Seguro do veículo",
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
