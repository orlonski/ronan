import { z } from "zod";

/**
 * O pedido do cliente e a programação que nasce dele.
 *
 * ⚠️ Viagem programada é entidade SEPARADA da Viagem — nunca um status novo no
 * `StatusViagem`. Ver o comentário no model `ViagemPlanejada`.
 */

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use uma hora no formato HH:MM.");

// M3 converte as toneladas das viagens pela densidade do material do pedido —
// a balança pesa em t, mas granel se vende em m³.
export const UNIDADES_PEDIDO = ["VIAGENS", "TONELADAS", "M3"] as const;
export const UnidadePedidoSchema = z.enum(UNIDADES_PEDIDO);
export type UnidadePedidoTipo = z.infer<typeof UnidadePedidoSchema>;

export const UNIDADE_PEDIDO_LABEL: Record<UnidadePedidoTipo, string> = {
  VIAGENS: "viagens",
  TONELADAS: "toneladas",
  M3: "m³",
};

export const STATUS_PEDIDO = ["ABERTO", "EM_CURSO", "CUMPRIDO", "CANCELADO"] as const;
export const StatusPedidoSchema = z.enum(STATUS_PEDIDO);
export type StatusPedidoTipo = z.infer<typeof StatusPedidoSchema>;

export const STATUS_VIAGEM_PLANEJADA = [
  "PLANEJADA",
  "PUBLICADA",
  "ACEITA",
  "RECUSADA",
  "EM_EXECUCAO",
  "CUMPRIDA",
  "FURADA",
  "CANCELADA",
] as const;
export const StatusViagemPlanejadaSchema = z.enum(STATUS_VIAGEM_PLANEJADA);
export type StatusViagemPlanejadaTipo = z.infer<typeof StatusViagemPlanejadaSchema>;

export const STATUS_PLANEJADA_LABEL: Record<StatusViagemPlanejadaTipo, string> = {
  PLANEJADA: "No quadro",
  PUBLICADA: "Enviada ao motorista",
  ACEITA: "Aceita",
  RECUSADA: "Recusada",
  EM_EXECUCAO: "Rodando",
  CUMPRIDA: "Cumprida",
  FURADA: "Não rodou",
  CANCELADA: "Cancelada",
};

export const CriarPedidoInput = z
  .object({
    empresaId: z.string().uuid(),
    clienteId: z.string().uuid().nullish(),
    materialId: z.string().uuid().nullish(),
    localCargaId: z.string().uuid().nullish(),
    localDescargaId: z.string().uuid().nullish(),
    tipoServicoId: z.string().uuid().nullish(),
    quantidadeAlvo: z.number().positive().max(999999.999),
    unidadeAlvo: UnidadePedidoSchema.default("VIAGENS"),
    inicioEm: DATA,
    prazoEm: DATA.nullish(),
    prioridade: z.number().int().min(0).max(9).default(0),
    observacao: z.string().trim().max(1000).nullish(),
  })
  .refine((d) => !d.prazoEm || d.prazoEm >= d.inicioEm, {
    message: "O prazo não pode ser antes do início.",
    path: ["prazoEm"],
  });
export type CriarPedidoInput = z.infer<typeof CriarPedidoInput>;

export const AtualizarPedidoInput = z
  .object({
    clienteId: z.string().uuid().nullish(),
    materialId: z.string().uuid().nullish(),
    localCargaId: z.string().uuid().nullish(),
    localDescargaId: z.string().uuid().nullish(),
    tipoServicoId: z.string().uuid().nullish(),
    quantidadeAlvo: z.number().positive().max(999999.999).optional(),
    unidadeAlvo: UnidadePedidoSchema.optional(),
    inicioEm: DATA.optional(),
    prazoEm: DATA.nullish(),
    prioridade: z.number().int().min(0).max(9).optional(),
    status: StatusPedidoSchema.optional(),
    observacao: z.string().trim().max(1000).nullish(),
  })
  .refine((d) => !d.prazoEm || !d.inicioEm || d.prazoEm >= d.inicioEm, {
    message: "O prazo não pode ser antes do início.",
    path: ["prazoEm"],
  });
export type AtualizarPedidoInput = z.infer<typeof AtualizarPedidoInput>;

/** Programa uma viagem no quadro do dia. */
export const CriarViagemPlanejadaInput = z
  .object({
    pedidoId: z.string().uuid().nullish(),
    motoristaId: z.string().uuid().nullish(),
    veiculoId: z.string().uuid().nullish(),
    dataPrevista: DATA,
    janelaInicio: HORA.nullish(),
    janelaFim: HORA.nullish(),
    sequencia: z.number().int().min(0).max(99).default(0),
    observacao: z.string().trim().max(500).nullish(),
    /** Cria N viagens iguais de uma vez — o caso normal ("4 viagens hoje"). */
    repetir: z.number().int().min(1).max(20).default(1),
  })
  .refine((d) => !d.janelaFim || !d.janelaInicio || d.janelaFim > d.janelaInicio, {
    message: "O fim da janela precisa ser depois do início.",
    path: ["janelaFim"],
  });
export type CriarViagemPlanejadaInput = z.infer<typeof CriarViagemPlanejadaInput>;

export const AtualizarViagemPlanejadaInput = z.object({
  pedidoId: z.string().uuid().nullish(),
  motoristaId: z.string().uuid().nullish(),
  veiculoId: z.string().uuid().nullish(),
  dataPrevista: DATA.optional(),
  janelaInicio: HORA.nullish(),
  janelaFim: HORA.nullish(),
  sequencia: z.number().int().min(0).max(99).optional(),
  status: StatusViagemPlanejadaSchema.optional(),
  observacao: z.string().trim().max(500).nullish(),
});
export type AtualizarViagemPlanejadaInput = z.infer<typeof AtualizarViagemPlanejadaInput>;

/**
 * Publica a programação de um dia: o motorista passa a ver no app e recebe
 * aviso. Separado do salvar de propósito — montar o quadro é rascunho, e o
 * supervisor mexe nele a manhã inteira antes de mandar.
 */
export const PublicarProgramacaoInput = z.object({
  data: DATA,
  /** Vazio = todos os motoristas com viagem programada nesse dia. */
  motoristaIds: z.array(z.string().uuid()).optional(),
});
export type PublicarProgramacaoInput = z.infer<typeof PublicarProgramacaoInput>;

/**
 * Repetir a programação de outro dia (o padrão na tela é o dia útil anterior).
 * `simular` (padrão) só diz o que entraria; nada é publicado — as cópias nascem
 * PLANEJADA e o motorista só fica sabendo quando alguém publica.
 */
export const CopiarProgramacaoInput = z
  .object({ de: DATA, para: DATA, simular: z.boolean().default(true) })
  .refine((d) => d.de !== d.para, { message: "Escolha um dia diferente do que está aberto.", path: ["de"] });
export type CopiarProgramacaoInput = z.infer<typeof CopiarProgramacaoInput>;

/** A resposta do motorista, no app dele. */
export const ResponderProgramacaoInput = z
  .object({
    aceita: z.boolean(),
    motivo: z.string().trim().max(300).optional(),
  })
  .refine((d) => d.aceita || (d.motivo != null && d.motivo.length >= 3), {
    // Recusar sem dizer por quê deixa o supervisor adivinhando com um caminhão
    // parado. Aceitar não precisa de nada.
    message: "Diga por que não vai dar.",
    path: ["motivo"],
  });
export type ResponderProgramacaoInput = z.infer<typeof ResponderProgramacaoInput>;

// ─────────────────────────── anexos do pedido ───────────────────────────

/**
 * O que pode ser anexado ao pedido. PDF e foto: é o que o escritório tem de
 * papel (croqui escaneado, OS do cliente, print do mapa do bota-fora).
 * 15 MB = o mesmo teto da OS de manutenção; o app mostra o tamanho antes de
 * baixar, porque é o 4G do motorista que paga.
 */
export const LIMITE_ANEXO_PEDIDO = {
  bytes: 15 * 1024 * 1024,
  rotulo: "15 MB",
  mimes: ["application/pdf", "image/jpeg", "image/jpg", "image/png"] as readonly string[],
  /** Teto por pedido: mais que isso é pasta de projeto, não papel de portaria. */
  porPedido: 20,
} as const;

/** O anexo como o painel vê. */
export type AnexoPedidoAdmin = {
  id: string;
  pedidoId: string;
  nome: string;
  mime: string;
  tamanho: number;
  visivelMotorista: boolean;
  criadoEm: string;
  enviadoPor: { id: string; nome: string } | null;
};

/** O anexo como o motorista vê: só os visíveis, sem quem mandou. */
export type AnexoPedidoMotorista = {
  id: string;
  pedidoId: string;
  nome: string;
  mime: string;
  tamanho: number;
  criadoEm: string;
};

export const AtualizarAnexoPedidoInput = z.object({
  visivelMotorista: z.boolean(),
});
export type AtualizarAnexoPedidoInput = z.infer<typeof AtualizarAnexoPedidoInput>;

/** O que o motorista vê no app: a viagem que programaram pra ele. */
export type ViagemProgramada = {
  id: string;
  dataPrevista: string;
  janelaInicio: string | null;
  janelaFim: string | null;
  sequencia: number;
  status: StatusViagemPlanejadaTipo;
  observacao: string | null;
  material: { id: string; nome: string } | null;
  cliente: { id: string; nome: string } | null;
  localCarga: { id: string; nome: string; cidade: string | null; uf: string | null } | null;
  localDescarga: { id: string; nome: string; cidade: string | null; uf: string | null } | null;
  veiculo: { id: string; placa: string } | null;
  /**
   * Opcionais de propósito: o cache da programação gravado antes deste campo
   * não tem nenhum dos dois, e quem lê usa `?? []` (compat on-read).
   */
  pedidoId?: string | null;
  /** Os documentos do pedido que o escritório deixou visíveis pra ele. */
  anexos?: AnexoPedidoMotorista[];
};
