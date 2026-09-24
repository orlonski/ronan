import { z } from "zod";

/** Manutenção, pneu, documento do veículo e multa. */

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use uma data no formato AAAA-MM-DD.");

export const TIPOS_MANUTENCAO = ["PREVENTIVA", "CORRETIVA", "PNEU", "SINISTRO", "OUTRO"] as const;
export const STATUS_MANUTENCAO = ["ABERTA", "EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"] as const;
export const STATUS_MULTA = ["RECEBIDA", "INDICADA", "RECORRIDA", "PAGA", "CANCELADA"] as const;

export const TipoManutencaoSchema = z.enum(TIPOS_MANUTENCAO);
export const StatusManutencaoSchema = z.enum(STATUS_MANUTENCAO);
export const StatusMultaSchema = z.enum(STATUS_MULTA);
export type TipoManutencaoTipo = z.infer<typeof TipoManutencaoSchema>;
export type StatusManutencaoTipo = z.infer<typeof StatusManutencaoSchema>;
export type StatusMultaTipo = z.infer<typeof StatusMultaSchema>;

export const TIPO_MANUTENCAO_LABEL: Record<TipoManutencaoTipo, string> = {
  PREVENTIVA: "Preventiva",
  CORRETIVA: "Corretiva (quebrou)",
  PNEU: "Pneu",
  SINISTRO: "Sinistro",
  OUTRO: "Outro",
};

export const STATUS_MANUTENCAO_LABEL: Record<StatusManutencaoTipo, string> = {
  ABERTA: "Agendada",
  EM_ANDAMENTO: "Na oficina",
  CONCLUIDA: "Concluída",
  CANCELADA: "Cancelada",
};

export const STATUS_MULTA_LABEL: Record<StatusMultaTipo, string> = {
  RECEBIDA: "Recebida",
  INDICADA: "Condutor indicado",
  RECORRIDA: "Em recurso",
  PAGA: "Paga",
  CANCELADA: "Cancelada",
};

/** Tipos de documento do veículo que quase toda frota tem. Sugestão, não trava. */
export const TIPOS_DOCUMENTO_VEICULO = [
  "CRLV",
  "SEGURO",
  "TACOGRAFO",
  "ANTT",
  "AET",
  "OUTRO",
] as const;

export const CriarManutencaoInput = z.object({
  veiculoId: z.string().uuid(),
  tipo: TipoManutencaoSchema.default("PREVENTIVA"),
  descricao: z.string().trim().min(3).max(200),
  odometro: z.number().int().nonnegative().max(9999999).nullish(),
  previstaEm: DATA.nullish(),
  fornecedorId: z.string().uuid().nullish(),
  valorPecas: z.number().nonnegative().max(999999.99).nullish(),
  valorMaoObra: z.number().nonnegative().max(999999.99).nullish(),
  observacao: z.string().trim().max(500).nullish(),
  /** O plano preventivo que esta OS cumpre — zera quando ela for concluída. */
  planoId: z.string().uuid().nullish(),
  /**
   * CONCLUIDA = lançando serviço que JÁ foi feito (zera o plano na hora).
   * Ausente = ABERTA, como sempre foi.
   */
  status: z.enum(["ABERTA", "CONCLUIDA"]).optional(),
  /** Com status CONCLUIDA: gera a conta a pagar do total, se houver valor. */
  gerarContaPagar: z.boolean().optional(),
});
export type CriarManutencaoInput = z.infer<typeof CriarManutencaoInput>;

export const AtualizarManutencaoInput = z.object({
  status: StatusManutencaoSchema.optional(),
  descricao: z.string().trim().min(3).max(200).optional(),
  odometro: z.number().int().nonnegative().max(9999999).nullish(),
  fornecedorId: z.string().uuid().nullish(),
  valorPecas: z.number().nonnegative().max(999999.99).nullish(),
  valorMaoObra: z.number().nonnegative().max(999999.99).nullish(),
  observacao: z.string().trim().max(500).nullish(),
  /** True = gera a conta a pagar do valor total ao concluir. */
  gerarContaPagar: z.boolean().optional(),
});
export type AtualizarManutencaoInput = z.infer<typeof AtualizarManutencaoInput>;

/** Desmarcar um conserto que não vai acontecer (a oficina desmarcou, agendou errado). */
export const CancelarManutencaoInput = z.object({
  motivo: z.string().trim().min(3, "Diga por que o conserto foi cancelado.").max(300),
});
export type CancelarManutencaoInput = z.infer<typeof CancelarManutencaoInput>;

export const CriarPlanoManutencaoInput = z
  .object({
    veiculoId: z.string().uuid(),
    descricao: z.string().trim().min(3).max(120),
    intervaloKm: z.number().int().positive().max(999999).nullish(),
    intervaloDias: z.number().int().positive().max(3650).nullish(),
    ultimoOdometro: z.number().int().nonnegative().max(9999999).nullish(),
    ultimaEm: DATA.nullish(),
  })
  .refine((d) => d.intervaloKm != null || d.intervaloDias != null, {
    // Sem nenhum dos dois o plano nunca dispara — e um plano que nunca dispara
    // dá a sensação de que a manutenção está controlada quando não está.
    message: "Diga a cada quantos km ou a cada quantos dias.",
    path: ["intervaloKm"],
  });
export type CriarPlanoManutencaoInput = z.infer<typeof CriarPlanoManutencaoInput>;

/** Editar o plano: mesmos campos, sem trocar de caminhão. */
export const AtualizarPlanoManutencaoInput = z
  .object({
    descricao: z.string().trim().min(3).max(120),
    intervaloKm: z.number().int().positive().max(999999).nullish(),
    intervaloDias: z.number().int().positive().max(3650).nullish(),
    ultimoOdometro: z.number().int().nonnegative().max(9999999).nullish(),
    ultimaEm: DATA.nullish(),
  })
  .refine((d) => d.intervaloKm != null || d.intervaloDias != null, {
    message: "Diga a cada quantos km ou a cada quantos dias.",
    path: ["intervaloKm"],
  });
export type AtualizarPlanoManutencaoInput = z.infer<typeof AtualizarPlanoManutencaoInput>;

export const SalvarDocumentoVeiculoInput = z.object({
  veiculoId: z.string().uuid(),
  tipo: z.string().trim().min(2).max(30),
  numero: z.string().trim().max(40).nullish(),
  validade: DATA.nullish(),
  observacao: z.string().trim().max(300).nullish(),
});
export type SalvarDocumentoVeiculoInput = z.infer<typeof SalvarDocumentoVeiculoInput>;

export const SalvarPneuInput = z.object({
  numeroFogo: z.string().trim().min(1).max(30),
  marca: z.string().trim().max(40).nullish(),
  medida: z.string().trim().max(30).nullish(),
  veiculoId: z.string().uuid().nullish(),
  posicao: z.string().trim().max(10).nullish(),
  sulcoMm: z.number().positive().max(30).nullish(),
  odometroInstalacao: z.number().int().nonnegative().max(9999999).nullish(),
  recapagens: z.number().int().min(0).max(10).optional(),
  valorCompra: z.number().positive().max(99999.99).nullish(),
  observacao: z.string().trim().max(300).nullish(),
});
export type SalvarPneuInput = z.infer<typeof SalvarPneuInput>;

export const CriarMultaInput = z.object({
  veiculoId: z.string().uuid().nullish(),
  motoristaId: z.string().uuid().nullish(),
  numeroAit: z.string().trim().max(40).nullish(),
  infracao: z.string().trim().min(3).max(200),
  gravidade: z.enum(["LEVE", "MEDIA", "GRAVE", "GRAVISSIMA"]).nullish(),
  pontos: z.number().int().min(0).max(7).nullish(),
  local: z.string().trim().max(200).nullish(),
  ocorridaEm: z.string(),
  valor: z.number().positive().max(99999.99),
  valorComDesconto: z.number().positive().max(99999.99).nullish(),
  vencimento: DATA.nullish(),
  prazoIndicacao: DATA.nullish(),
  observacao: z.string().trim().max(500).nullish(),
});
export type CriarMultaInput = z.infer<typeof CriarMultaInput>;

export const AtualizarMultaInput = z.object({
  motoristaId: z.string().uuid().nullish(),
  status: StatusMultaSchema.optional(),
  descontarDoMotorista: z.boolean().optional(),
  observacao: z.string().trim().max(500).nullish(),
});
export type AtualizarMultaInput = z.infer<typeof AtualizarMultaInput>;

/** Pontos por gravidade, pelo CTB. Usado pra sugerir na tela. */
export const PONTOS_POR_GRAVIDADE: Record<string, number> = {
  LEVE: 3,
  MEDIA: 4,
  GRAVE: 5,
  GRAVISSIMA: 7,
};

/**
 * O aviso de problema no caminhão, mandado pelo app (campos de texto do
 * multipart; as fotos vão no mesmo envio, no campo `fotos`).
 */
export const AvisarProblemaVeiculoInput = z.object({
  /** O `clientId` do outbox: reenvio não duplica. */
  clientId: z.string().trim().min(8).max(80),
  veiculoId: z.string().uuid().nullish(),
  descricao: z.string().trim().min(3, "Conte o que está acontecendo.").max(1000),
  /** Quando ele avisou no aparelho — o envio pode ter esperado sinal. */
  avisadoEm: z.coerce.date().optional(),
  /**
   * "Dá pra continuar rodando?". Opcional porque o app anterior não
   * perguntava, e o aviso dele pode estar na fila esperando sinal.
   */
  podeRodar: z.enum(["SIM", "COM_CUIDADO", "NAO"]).nullish(),
  /** Onde parou — o app só manda quando `podeRodar` é NAO. */
  lat: z.coerce.number().min(-90).max(90).nullish(),
  lng: z.coerce.number().min(-180).max(180).nullish(),
});
export type AvisarProblemaVeiculoInput = z.infer<typeof AvisarProblemaVeiculoInput>;

export const STATUS_PROBLEMA_VEICULO = ["ABERTO", "VIROU_MANUTENCAO", "DESCARTADO"] as const;
export type StatusProblemaVeiculoTipo = (typeof STATUS_PROBLEMA_VEICULO)[number];

export const PODE_RODAR_LABEL: Record<"SIM" | "COM_CUIDADO" | "NAO", string> = {
  SIM: "Dá pra rodar",
  COM_CUIDADO: "Dá pra rodar com cuidado",
  NAO: "Caminhão parado",
};

/** O escritório decidindo o aviso que não vira manutenção. */
export const DescartarProblemaVeiculoInput = z.object({
  motivo: z.string().trim().min(3, "Diga por que não vira manutenção.").max(300),
});
export type DescartarProblemaVeiculoInput = z.infer<typeof DescartarProblemaVeiculoInput>;

/** O escritório transformando o aviso numa manutenção aberta. */
export const AbrirManutencaoDoProblemaInput = z.object({
  veiculoId: z.string().uuid().optional(),
  tipo: TipoManutencaoSchema.optional(),
  descricao: z.string().trim().min(3).max(300).optional(),
  /** A oficina que vai fazer. */
  fornecedorId: z.string().uuid().nullish(),
  /** O plano preventivo que este conserto cumpre (zera na conclusão). */
  planoId: z.string().uuid().nullish(),
  previstaEm: DATA.nullish(),
});
export type AbrirManutencaoDoProblemaInput = z.infer<typeof AbrirManutencaoDoProblemaInput>;

/** O mesmo plano pra vários caminhões de uma vez (40 caminhões = 1 formulário). */
export const CriarPlanosEmLoteInput = z
  .object({
    veiculoIds: z.array(z.string().uuid()).min(1, "Escolha pelo menos um caminhão.").max(500),
    descricao: z.string().trim().min(3).max(120),
    intervaloKm: z.number().int().positive().max(999999).nullish(),
    intervaloDias: z.number().int().positive().max(3650).nullish(),
  })
  .refine((d) => d.intervaloKm != null || d.intervaloDias != null, {
    message: "Diga a cada quantos km ou a cada quantos dias.",
    path: ["intervaloKm"],
  });
export type CriarPlanosEmLoteInput = z.infer<typeof CriarPlanosEmLoteInput>;

/** O motorista conferindo o conserto do aviso dele. */
export const ConfirmarConsertoInput = z.object({
  ficouBom: z.boolean(),
  comentario: z.string().trim().max(500).nullish(),
});
export type ConfirmarConsertoInput = z.infer<typeof ConfirmarConsertoInput>;

/** Odômetro conferido no painel do caminhão: vira a âncora do km estimado. */
export const ConferirOdometroInput = z.object({
  odometro: z.number().int().positive().max(9_999_999),
  lidoEm: DATA,
  observacao: z.string().trim().max(300).nullish(),
});
export type ConferirOdometroInput = z.infer<typeof ConferirOdometroInput>;
