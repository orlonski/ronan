import { z } from "zod";

/**
 * O caderninho do motorista — o que ele gastou e recebeu, do bolso dele.
 *
 * Nada disto é da transportadora: nenhuma empresa vê, e continua existindo
 * quando ele troca de empresa ou não está em nenhuma. Ver
 * docs/identidade-motorista.md.
 */
export const TIPOS_LANCAMENTO_PESSOAL = [
  "ABASTECIMENTO",
  "PEDAGIO",
  "MANUTENCAO",
  "ALIMENTACAO",
  "OUTRO_GASTO",
  "GANHO",
] as const;
export type TipoLancamentoPessoal = (typeof TIPOS_LANCAMENTO_PESSOAL)[number];

/** Como cada tipo se chama pro motorista. Um lugar só — os dois apps leem daqui. */
export const ROTULO_LANCAMENTO_PESSOAL: Record<TipoLancamentoPessoal, string> = {
  ABASTECIMENTO: "Abastecimento",
  PEDAGIO: "Pedágio",
  MANUTENCAO: "Manutenção",
  ALIMENTACAO: "Alimentação",
  OUTRO_GASTO: "Outro gasto",
  GANHO: "Recebimento",
};

/** GANHO é o que entrou; todo o resto saiu. Decide o sinal em toda soma. */
export function ehGanho(tipo: TipoLancamentoPessoal): boolean {
  return tipo === "GANHO";
}

/** Dia civil no formato YYYY-MM-DD (o app manda a data DELE, não a do servidor). */
const DataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Data inválida");

/**
 * Valor em reais. Aceita número ou string ("123,45" do teclado do celular) e
 * sai sempre como número — o motorista digita vírgula, e recusar isso seria
 * cobrar dele um formato que o teclado dele nem sugere.
 */
const ValorSchema = z.preprocess(
  (v) => (typeof v === "string" ? Number(v.replace(/\./g, "").replace(",", ".")) : v),
  z.number().positive("Informe um valor maior que zero").max(999_999.99),
);

const OpcionalPositivo = z.preprocess(
  (v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    return typeof v === "string" ? Number(v.replace(/\./g, "").replace(",", ".")) : v;
  },
  z.number().positive().optional(),
);

export const CriarLancamentoPessoalInput = z
  .object({
    /** Gerado no aparelho: é o que faz o reenvio do outbox não virar duplicata. */
    clientId: z.string().min(8).max(64),
    tipo: z.enum(TIPOS_LANCAMENTO_PESSOAL),
    data: DataSchema,
    valor: ValorSchema,
    litros: OpcionalPositivo,
    odometro: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().int().positive().max(9_999_999).optional(),
    ),
    descricao: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    // Litro em pedágio ou almoço não quer dizer nada — e aceitar em silêncio
    // faria a média de consumo mentir.
    if (v.litros !== undefined && v.tipo !== "ABASTECIMENTO") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["litros"],
        message: "Litros só valem em abastecimento",
      });
    }
  });
export type CriarLancamentoPessoalInput = z.infer<typeof CriarLancamentoPessoalInput>;

export type LancamentoPessoal = {
  id: string;
  clientId: string;
  tipo: TipoLancamentoPessoal;
  data: string;
  valor: number;
  litros: number | null;
  odometro: number | null;
  descricao: string | null;
  criadoEm: string;
};

/** O mês fechado: quanto entrou, quanto saiu e o que sobrou. */
export type ResumoMesPessoal = {
  /** YYYY-MM */
  mes: string;
  ganhos: number;
  gastos: number;
  saldo: number;
  /** Só de abastecimento — o que sustenta a média de R$/litro. */
  litros: number;
  precoMedioLitro: number | null;
  porTipo: { tipo: TipoLancamentoPessoal; total: number; quantidade: number }[];
};
