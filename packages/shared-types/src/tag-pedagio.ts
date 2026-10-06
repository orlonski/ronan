import { z } from "zod";

/**
 * Conferência da tag de pedágio (módulo `tag-pedagio`).
 *
 * O escritório sobe a fatura do Sem Parar; o servidor lê com 6 checagens,
 * corta as passagens de cada placa em trechos, liga cada trecho carregado à
 * viagem lançada e separa o que vale dinheiro em três caixas. Nada aqui afirma:
 * tudo é sugestão pra gente confirmar (regra "IA nunca afirma").
 *
 * Desenho: docs/tag-pedagio/03-proposta.md (Onda 1), 04-qa.md e 05-prova.
 */

export const STATUS_EXTRATO_TAG = ["LIDO", "LIDO_COM_DIVERGENCIA", "FALHOU"] as const;
export type StatusExtratoTag = (typeof STATUS_EXTRATO_TAG)[number];

/** Como uma passagem (o trecho dela) foi ligada a uma viagem. */
export const TIPO_LIGACAO_TAG = ["AUTO", "SUGESTAO", "MANUAL", "RETORNO", "NAO_E_VIAGEM"] as const;
export type TipoLigacaoTag = (typeof TIPO_LIGACAO_TAG)[number];

/** As três caixas do raio-x. Cada passagem cai em UMA só (04-qa B2). */
export const CAIXA_ACHADO_TAG = ["PODE_SER_SEU", "PRA_CONTESTAR", "PRA_CONVERSAR"] as const;
export type CaixaAchadoTag = (typeof CAIXA_ACHADO_TAG)[number];

export const CAIXA_ACHADO_TAG_ROTULO: Record<CaixaAchadoTag, string> = {
  PODE_SER_SEU: "Pode ser seu",
  PRA_CONTESTAR: "Pra conferir e contestar",
  PRA_CONVERSAR: "Pra conversar",
};

export const TIPO_ACHADO_TAG = [
  // fato do documento
  "AJUSTE_NAO_DETALHADO",
  "FORA_DO_PERIODO",
  "COBRADA_EM_OUTRA_FATURA",
  "VALE_SEM_PAR",
  // vale da viagem
  "VALE_PARCIAL",
  "VALE_ORIGEM_A_CONFERIR",
  // carregado sem vale (por viagem inferida)
  "CARREGADO_SEM_VALE",
  // praça
  "DUPLICIDADE",
  "SENTIDO_OPOSTO_CURTO",
  "PRACA_PULADA",
  // eixo e conversa
  "EIXO_ACIMA_DO_CADASTRO",
  "EIXO_SOBE_E_DESCE",
  "EIXO_VAZIO_A_MAIS",
  "TAXAS_NAO_PEDAGIO",
  // duas hipóteses que se excluem viram um achado só
  "EXPLICACOES_POSSIVEIS",
] as const;
export type TipoAchadoTag = (typeof TIPO_ACHADO_TAG)[number];

export const TIPO_ACHADO_TAG_ROTULO: Record<TipoAchadoTag, string> = {
  AJUSTE_NAO_DETALHADO: "Diferença entre o resumo e o detalhe da fatura",
  FORA_DO_PERIODO: "Passagem de fora do período da fatura",
  COBRADA_EM_OUTRA_FATURA: "Passagem cobrada em outra fatura também",
  VALE_SEM_PAR: "Vale-pedágio sem o par (crédito × débito)",
  VALE_PARCIAL: "Vale-pedágio cobriu só parte da viagem",
  VALE_ORIGEM_A_CONFERIR: "Praça antes do vale: conferir onde carregou",
  CARREGADO_SEM_VALE: "Viagem carregada sem vale-pedágio",
  DUPLICIDADE: "Mesma praça, mesmo sentido, cobrada duas vezes",
  SENTIDO_OPOSTO_CURTO: "Mesma praça nos dois sentidos em pouco tempo",
  PRACA_PULADA: "Praça que a tag não cobrou no caminho",
  EIXO_ACIMA_DO_CADASTRO: "Eixos cobrados acima do cadastro do caminhão",
  EIXO_SOBE_E_DESCE: "Eixo que sobe e desce no mesmo trecho",
  EIXO_VAZIO_A_MAIS: "Volta vazia com mais eixos no chão que o de costume",
  TAXAS_NAO_PEDAGIO: "O que a fatura cobra que não é pedágio",
  EXPLICACOES_POSSIVEIS: "Duas explicações possíveis",
};

export const STATUS_ACHADO_TAG = ["ABERTO", "CONFERIDO", "CONTESTADO", "DESCARTADO"] as const;
export type StatusAchadoTag = (typeof STATUS_ACHADO_TAG)[number];

/** "Essa carga era de quem?" — por viagem inferida (04-qa I1, I2). */
export const RESPOSTA_CARGA_TAG = ["CLIENTE", "CARGA_PROPRIA", "PAGOU_DE_OUTRO_JEITO", "NAO_SEI"] as const;
export type RespostaCargaTag = (typeof RESPOSTA_CARGA_TAG)[number];

export const RESPOSTA_CARGA_TAG_ROTULO: Record<RespostaCargaTag, string> = {
  CLIENTE: "De um cliente (sem vale)",
  CARGA_PROPRIA: "Carga minha",
  PAGOU_DE_OUTRO_JEITO: "O contratante pagou o pedágio de outro jeito",
  NAO_SEI: "Não sei",
};

const id = z.string().min(1).max(64);

/** Campos do multipart da importação (chegam como texto). */
export const ImportarFaturaTagInput = z.object({
  /** A raiz do CNPJ da fatura não é a da empresa: só entra com "sim, é nossa". */
  confirmarCnpj: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
});
export type ImportarFaturaTagInput = z.infer<typeof ImportarFaturaTagInput>;

export const AcaoLigacaoTag = z.enum(["ACEITAR", "OUTRA_VIAGEM", "NAO_E_VIAGEM", "RETORNO", "DESFAZER"]);
export type AcaoLigacaoTag = z.infer<typeof AcaoLigacaoTag>;

export const DecidirLigacaoTagInput = z
  .object({
    /** A 1ª passagem do trecho: a decisão se ancora nela, não no conjunto. */
    passagemAncoraId: id,
    acao: AcaoLigacaoTag,
    viagemId: id.optional(),
    motivo: z.string().trim().max(500).optional(),
  })
  .refine((v) => !["OUTRA_VIAGEM", "RETORNO"].includes(v.acao) || !!v.viagemId, {
    message: "Escolha a viagem.",
    path: ["viagemId"],
  });
export type DecidirLigacaoTagInput = z.infer<typeof DecidirLigacaoTagInput>;

export const AceitarSugestoesTagInput = z.object({
  passagemAncoraIds: z.array(id).min(1).max(500),
});
export type AceitarSugestoesTagInput = z.infer<typeof AceitarSugestoesTagInput>;

export const ResponderCargaTagInput = z
  .object({
    passagemAncoraId: id,
    resposta: z.enum(RESPOSTA_CARGA_TAG),
    /** O contratante: Empresa (quem paga o frete; na tela, "Cliente"). */
    empresaId: id.optional(),
    /** "Pagou de outro jeito": nº do CIOT, do comprovante, a outra tag. */
    comprovante: z.string().trim().max(300).optional(),
    observacao: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.resposta !== "CLIENTE" || !!v.empresaId, {
    message: "Escolha o cliente.",
    path: ["empresaId"],
  });
export type ResponderCargaTagInput = z.infer<typeof ResponderCargaTagInput>;

export const ConfirmarPracaTagInput = z.object({
  operadora: z.string().min(1).max(40),
  chavePraca: z.string().min(1).max(60),
  pedagioRodoviaId: id,
  /** Vale pra todas as empresas. Só a equipe da plataforma (04-qa M6). */
  global: z.boolean().optional(),
});
export type ConfirmarPracaTagInput = z.infer<typeof ConfirmarPracaTagInput>;

export const DecidirAchadoTagInput = z
  .object({
    status: z.enum(STATUS_ACHADO_TAG),
    motivo: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== "DESCARTADO" || (v.motivo?.length ?? 0) >= 3, {
    message: "Diga por que descartou.",
    path: ["motivo"],
  });
export type DecidirAchadoTagInput = z.infer<typeof DecidirAchadoTagInput>;

/**
 * Eixos no cadastro do caminhão (03-proposta, decisão e; 04-qa I6): o cavalo e
 * a composição de costume, mais quantos ele suspende vazio. Opcional — e a
 * sugestão vem da MODA das passagens carregadas, nunca do máximo.
 */
export const EixosVeiculoInput = z.object({
  eixosCavalo: z.number().int().min(2).max(5).nullable().optional(),
  eixosComposicao: z.number().int().min(2).max(12).nullable().optional(),
  eixosSuspensosVazio: z.number().int().min(0).max(6).nullable().optional(),
});
export type EixosVeiculoInput = z.infer<typeof EixosVeiculoInput>;

export const ConfigTagInput = z.object({
  /** false (padrão) = o que ligaria sozinho vira sugestão destacada. */
  ligacaoAutomaticaTag: z.boolean(),
});
export type ConfigTagInput = z.infer<typeof ConfigTagInput>;

/** Prazo do Sem Parar pra contestar: 90 dias da data da passagem (pré-pago). */
export const PRAZO_CONTESTACAO_TAG_DIAS = 90;
/** Retenção do PDF original: prazo do vale (12 meses) + folga. */
export const RETENCAO_PDF_TAG_MESES = 13;
