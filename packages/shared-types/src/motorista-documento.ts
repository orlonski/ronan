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

/**
 * A trilha do aceite eletrônico, do jeito que o escritório precisa ver.
 *
 * ⚠️ Isto já vinha da API e o painel jogava fora — o tipo simplesmente não
 * tinha o campo. A evidência que dá valor jurídico à assinatura simples
 * (quem declarou ser, o CPF, o IP, a hora e o hash do arquivo) existia e não
 * era exibível em lugar nenhum do produto: numa audiência, alguém teria que
 * consultar a API na mão.
 */
export const AssinaturaDocumentoOutput = z.object({
  modo: z.enum(["SIMPLES", "ICP_BRASIL", "NO_PAPEL"]),
  nome: z.string().nullable(),
  cpf: z.string().nullable(),
  ip: z.string().nullable(),
  hash: z.string(),
  assinadoEm: z.string(),
  /**
   * A assinatura ainda bate com o arquivo guardado?
   *
   * `null` = não dá pra dizer (documento anterior a 21/09/2026, quando o hash
   * passou a ser gravado no upload). Nulo NÃO é "confere": a tela tem que
   * dizer que não sabe.
   */
  confere: z.boolean().nullable(),
  aviso: z.string().nullable(),
});
export type AssinaturaDocumentoOutput = z.infer<typeof AssinaturaDocumentoOutput>;

export const MotoristaDocumentoOutput = z.object({
  id: z.string(),
  tipo: TipoDocumentoMotoristaSchema,
  /** Como apontar pra ESTE documento nas rotas (`exig:<id>` ou `gaveta:<TIPO>`). */
  chave: z.string(),
  /** A exigência que ele atende; nulo quando é anexo avulso do painel. */
  exigenciaId: z.string().nullable(),
  /** O nome que o contratante deu ao papel — o rótulo da gaveta não distingue. */
  titulo: z.string().nullable(),
  origem: z.enum(["PAINEL", "LINK", "APP"]),
  nomeArquivo: z.string(),
  mimetype: z.string(),
  tamanho: z.number().int(),
  validade: z.string().nullable(),
  criadoEm: z.string(),
  alteradoEm: z.string(),
  assinatura: AssinaturaDocumentoOutput.nullable().optional(),
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
