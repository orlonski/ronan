import { z } from "zod";

/**
 * O que cada foto do abastecimento comprova.
 *
 * Ordem = ordem na tela do app (o motorista tira nesta sequência). Molde de
 * `motorista-documento.ts`, o único precedente de arquivo tipado no repo.
 */
export const TIPOS_FOTO_ABASTECIMENTO = ["CUPOM", "ODOMETRO", "BOMBA"] as const;
export type TipoFotoAbastecimento = (typeof TIPOS_FOTO_ABASTECIMENTO)[number];
export const TipoFotoAbastecimentoSchema = z.enum(TIPOS_FOTO_ABASTECIMENTO);

export const ROTULO_FOTO_ABASTECIMENTO: Record<TipoFotoAbastecimento, string> = {
  CUPOM: "Cupom do posto",
  ODOMETRO: "Odômetro (KM)",
  BOMBA: "Bomba",
};

/** Foto já enviada (tem storageKey), pronta pra ser vinculada ao abastecimento. */
export const FotoAbastecimentoInput = z.object({
  fotoKey: z.string().min(1),
  tipo: TipoFotoAbastecimentoSchema,
});
export type FotoAbastecimentoInput = z.infer<typeof FotoAbastecimentoInput>;

export const TipoCombustivelEnum = z.enum([
  "DIESEL_S10",
  "DIESEL_S500",
  "ARLA_32",
  "GASOLINA",
  "ETANOL",
]);
export type TipoCombustivel = z.infer<typeof TipoCombustivelEnum>;

// Limites: respeitam Decimal(8,3) pra litros e Decimal(10,2) pra valor.
// Tanque de caminhão raramente passa de 600L; 2000L cobre tanques duplos.
// 50k cobre abastecimento de tanque cheio em diesel premium.
const MAX_LITROS = 2000;
const MAX_VALOR = 50_000;
const MAX_ODOMETRO = 99_999_999;

// Base ZodObject sem refine — permite .extend() em controllers/forms.
export const CriarAbastecimentoBaseInput = z.object({
  clientId: z.string().uuid(),
  veiculoId: z.string().uuid(),
  empresaId: z.string().uuid(),
  data: z.coerce.date(),
  tipo: TipoCombustivelEnum.default("DIESEL_S10"),
  litros: z
    .number()
    .positive()
    .max(MAX_LITROS, `Litros acima do limite (${MAX_LITROS}).`),
  // Opcional: motorista pode lançar sem valor quando abastece em comboio.
  valorTotal: z
    .number()
    .positive()
    .max(MAX_VALOR, `Valor acima do limite (${MAX_VALOR}).`)
    .optional(),
  // True quando motorista não sabe o valor (comboio). Admin pode preencher
  // depois pelo dashboard.
  emComboio: z.boolean().default(false),
  odometro: z.number().int().nonnegative().max(MAX_ODOMETRO),
  // `.trim()` porque o nome do posto é texto livre e vira CHAVE em dois lugares:
  // no agrupamento do relatório e na lista de sugestões que o app devolve pro
  // motorista. "Posto Trevo " e "Posto Trevo" viravam dois postos.
  postoNome: z.string().trim().max(120).optional(),
  tanqueCheio: z.boolean().default(true),
  observacao: z.string().max(500).optional(),
  // Por que veio sem o cupom do posto, numa empresa que exige a foto.
  // O APP é quem bloqueia; aqui é opcional (ver common/exige-foto.ts).
  justificativaSemFoto: z.string().min(10).max(500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  precisao: z.number().nonnegative().optional(),
  criadoOfflineEm: z.coerce.date().optional(),
});

// Wrapper com regra cruzada: valor obrigatório quando NÃO é em comboio.
export const CriarAbastecimentoInput = CriarAbastecimentoBaseInput.refine(
  (d) => d.emComboio || d.valorTotal !== undefined,
  {
    message: "Valor obrigatório quando não é abastecimento em comboio.",
    path: ["valorTotal"],
  },
);
export type CriarAbastecimentoInput = z.infer<typeof CriarAbastecimentoInput>;

/**
 * Input pra atualização parcial (admin no dashboard). Todos os campos
 * opcionais; precoLitro é recalculado no servidor a partir de litros+valor.
 * Campos imutáveis (motoristaId, clientId, lat, lng, criadoOfflineEm)
 * não entram aqui.
 */
export const AtualizarAbastecimentoInput = z
  .object({
    data: z.coerce.date().optional(),
    tipo: TipoCombustivelEnum.optional(),
    litros: z.number().positive().max(MAX_LITROS).optional(),
    valorTotal: z.number().positive().max(MAX_VALOR).nullable().optional(),
    emComboio: z.boolean().optional(),
    odometro: z.number().int().nonnegative().max(MAX_ODOMETRO).optional(),
    postoNome: z.string().trim().max(120).nullable().optional(),
    tanqueCheio: z.boolean().optional(),
    observacao: z.string().max(500).nullable().optional(),
    veiculoId: z.string().uuid().optional(),
    empresaId: z.string().uuid().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Informe ao menos um campo pra atualizar.",
  });
export type AtualizarAbastecimentoInput = z.infer<typeof AtualizarAbastecimentoInput>;
