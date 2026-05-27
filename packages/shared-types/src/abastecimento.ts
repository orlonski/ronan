import { z } from "zod";

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
  postoNome: z.string().max(120).optional(),
  tanqueCheio: z.boolean().default(true),
  observacao: z.string().max(500).optional(),
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
