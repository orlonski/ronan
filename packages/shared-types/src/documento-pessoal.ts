import { z } from "zod";

/**
 * A carteira do motorista: o que a transportadora e a gerenciadora de risco
 * pedem antes de liberar um frete.
 *
 * A lista saiu de pesquisa do que é exigido de fato, não de chute. O autônomo
 * refaz esse cadastro A CADA VIAGEM (agregado é semestral, frota é anual), então
 * ter tudo junto e em dia é a diferença entre pegar e perder a carga.
 */
export const TIPOS_DOCUMENTO_PESSOAL = [
  "CNH",
  "EXAME_TOXICOLOGICO",
  "RNTRC",
  "CRLV",
  "MOPP",
  "CERTIFICADO_TACOGRAFO",
  "ANTECEDENTES",
  "COMPROVANTE_RESIDENCIA",
  "IDENTIDADE_CPF",
  "OUTRO",
] as const;
export type TipoDocumentoPessoal = (typeof TIPOS_DOCUMENTO_PESSOAL)[number];

export const ROTULO_DOCUMENTO_PESSOAL: Record<TipoDocumentoPessoal, string> = {
  CNH: "CNH",
  EXAME_TOXICOLOGICO: "Exame toxicológico",
  RNTRC: "RNTRC (ANTT)",
  CRLV: "CRLV do veículo",
  MOPP: "MOPP",
  CERTIFICADO_TACOGRAFO: "Cronotacógrafo",
  ANTECEDENTES: "Antecedentes criminais",
  COMPROVANTE_RESIDENCIA: "Comprovante de residência",
  IDENTIDADE_CPF: "RG / CPF",
  OUTRO: "Outro documento",
};

/** Uma linha de ajuda por tipo — o que costuma travar em cada um. */
export const AJUDA_DOCUMENTO_PESSOAL: Partial<Record<TipoDocumentoPessoal, string>> = {
  CNH: "Precisa estar na categoria da carga e com a observação EAR.",
  EXAME_TOXICOLOGICO:
    "Vale 2 anos e 6 meses. A multa vem sozinha 30 dias depois de vencer, sem você ser parado.",
  RNTRC: "O registro na ANTT. Sem ele você não emite CIOT nem pega carga como autônomo.",
  CRLV: "Um por placa — o cavalo e cada carreta.",
  CERTIFICADO_TACOGRAFO: "Verificação a cada 2 anos, obrigatória acima de 4.536 kg de PBT.",
  MOPP: "Só pra quem carrega produto perigoso.",
};

/** Tipos que existem UM POR VEÍCULO — a placa é o que distingue as linhas. */
export const DOCUMENTO_POR_PLACA: TipoDocumentoPessoal[] = ["CRLV", "CERTIFICADO_TACOGRAFO"];

/**
 * Quantos dias antes o app começa a avisar.
 *
 * O toxicológico avisa MUITO antes de propósito: o exame demora dias pra sair e
 * a multa é automática 30 dias depois do vencimento — avisar em cima da hora
 * seria avisar tarde.
 */
export const DIAS_AVISO_DOCUMENTO: Partial<Record<TipoDocumentoPessoal, number>> = {
  EXAME_TOXICOLOGICO: 60,
};
export const DIAS_AVISO_PADRAO = 30;

export type StatusDocumento = "SEM_VALIDADE" | "EM_DIA" | "VENCENDO" | "VENCIDO";

export type DocumentoPessoal = {
  id: string;
  tipo: TipoDocumentoPessoal;
  numero: string | null;
  validade: string | null;
  placa: string | null;
  observacao: string | null;
  temArquivo: boolean;
  status: StatusDocumento;
  /** Negativo = já venceu há tantos dias. Null quando não vence. */
  diasAteVencer: number | null;
};

const DataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Data inválida");

export const SalvarDocumentoPessoalInput = z.object({
  tipo: z.enum(TIPOS_DOCUMENTO_PESSOAL),
  numero: z.string().trim().max(60).optional(),
  validade: DataSchema.optional(),
  placa: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}-?\d[A-Z\d]\d{2}$/, "Placa inválida")
    .optional(),
  observacao: z.string().trim().max(200).optional(),
});
export type SalvarDocumentoPessoalInput = z.infer<typeof SalvarDocumentoPessoalInput>;

/**
 * O que a transportadora vê no link do cadastro.
 *
 * Documento, número, validade e situação — **sem a imagem**. Mandar CNH
 * escaneada por link público é exatamente como documento de gente vaza; quem
 * precisar do arquivo pede pra ele, que manda pelo canal que quiser.
 */
export type CadastroPessoalPublico = {
  motorista: string;
  destinatario: string | null;
  documentos: {
    tipo: TipoDocumentoPessoal;
    numero: string | null;
    validade: string | null;
    placa: string | null;
    status: StatusDocumento;
  }[];
  /** Resumo honesto pra quem vai liberar a carga. */
  tudoEmDia: boolean;
};
