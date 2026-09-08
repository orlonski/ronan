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

/**
 * A viagem que ele fez por conta própria.
 *
 * Origem, destino e carga são TEXTO: catálogo (local, material, cliente) é da
 * empresa, e aqui não há empresa. Só origem e destino são obrigatórios — o
 * resto ele preenche se tiver, e um frete anotado pela metade continua sendo
 * melhor que frete nenhum anotado.
 */
const CamposViagemPessoal = {
  data: DataSchema,
  origem: z.string().trim().min(2, "De onde você saiu?").max(120),
  destino: z.string().trim().min(2, "Pra onde você levou?").max(120),
  carga: z.string().trim().max(120).optional(),
  km: OpcionalPositivo,
  peso: OpcionalPositivo,
  valorRecebido: OpcionalPositivo,
  observacao: z.string().trim().max(200).optional(),
};

export const CriarViagemPessoalInput = z.object({
  clientId: z.string().min(8).max(64),
  ...CamposViagemPessoal,
});
export type CriarViagemPessoalInput = z.infer<typeof CriarViagemPessoalInput>;

/**
 * Corrigir um frete já gravado.
 *
 * Sem `clientId`: quem edita já sabe qual linha é (vai pela URL), e deixar o id
 * do aparelho ser reescrito quebraria a idempotência do outbox. O frete que
 * nasce do GPS guiado entra sem origem e sem valor — sem esta rota, "recebi
 * R$ 0" ficava gravado pra sempre.
 */
export const EditarViagemPessoalInput = z.object(CamposViagemPessoal);
export type EditarViagemPessoalInput = z.infer<typeof EditarViagemPessoalInput>;

export type ViagemPessoal = {
  id: string;
  clientId: string;
  data: string;
  origem: string;
  destino: string;
  carga: string | null;
  km: number | null;
  peso: number | null;
  valorRecebido: number | null;
  observacao: string | null;
  criadoEm: string;
};

const CamposLancamentoPessoal = {
  tipo: z.enum(TIPOS_LANCAMENTO_PESSOAL),
  data: DataSchema,
  valor: ValorSchema,
  litros: OpcionalPositivo,
  odometro: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().int().positive().max(9_999_999).optional(),
  ),
  descricao: z.string().trim().max(200).optional(),
};

/** Litro em pedágio ou almoço não quer dizer nada — e aceitar em silêncio faria
 *  a média de consumo mentir. */
const litroSoEmAbastecimento = (
  v: { litros?: number; tipo: TipoLancamentoPessoal },
  ctx: z.RefinementCtx,
) => {
  if (v.litros !== undefined && v.tipo !== "ABASTECIMENTO") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["litros"],
      message: "Litros só valem em abastecimento",
    });
  }
};

export const CriarLancamentoPessoalInput = z
  .object({
    /** Gerado no aparelho: é o que faz o reenvio do outbox não virar duplicata. */
    clientId: z.string().min(8).max(64),
    ...CamposLancamentoPessoal,
  })
  .superRefine(litroSoEmAbastecimento);
export type CriarLancamentoPessoalInput = z.infer<typeof CriarLancamentoPessoalInput>;

/** Corrigir um gasto já gravado. Sem `clientId`, pelo mesmo motivo do frete. */
export const EditarLancamentoPessoalInput = z
  .object(CamposLancamentoPessoal)
  .superRefine(litroSoEmAbastecimento);
export type EditarLancamentoPessoalInput = z.infer<typeof EditarLancamentoPessoalInput>;

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

/** O mês fechado: quanto ele rodou, quanto entrou, quanto saiu e o que sobrou. */
export type ResumoMesPessoal = {
  /** YYYY-MM */
  mes: string;
  /**
   * Tudo que entrou: o frete das viagens dele mais os recebimentos avulsos do
   * caderninho. São duas fontes porque nem todo dinheiro que entra vem de uma
   * viagem anotada — e nem toda viagem anotada tem valor preenchido.
   */
  ganhos: number;
  gastos: number;
  saldo: number;
  /** Das viagens dele no mês. */
  viagens: number;
  km: number;
  /** Quanto ele recebeu por km rodado. Null sem km ou sem frete informado. */
  ganhoPorKm: number | null;
  /** Só de abastecimento — o que sustenta a média de R$/litro. */
  litros: number;
  precoMedioLitro: number | null;
  porTipo: { tipo: TipoLancamentoPessoal; total: number; quantidade: number }[];
};

// ---- "Vale a pena esse frete?" ----

/**
 * O que o app pergunta antes de aceitar uma carga.
 *
 * Coordenadas, não texto: quem transforma "Curitiba" em ponto no mapa é o
 * geocoding, que o app já chama pra montar a busca — mandar texto aqui faria a
 * mesma consulta duas vezes e deixaria o backend adivinhando qual dos
 * resultados ele escolheu.
 */
export const EstimarFreteInput = z.object({
  origemLat: z.number().min(-90).max(90),
  origemLng: z.number().min(-180).max(180),
  destinoLat: z.number().min(-90).max(90),
  destinoLng: z.number().min(-180).max(180),
});
export type EstimarFreteInput = z.infer<typeof EstimarFreteInput>;

/** Navegação guiada até um ponto — origem é a posição AO VIVO dele. */
export const NavegarPessoalInput = z.object({
  origemLat: z.number().min(-90).max(90),
  origemLng: z.number().min(-180).max(180),
  destinoLat: z.number().min(-90).max(90),
  destinoLng: z.number().min(-180).max(180),
});
export type NavegarPessoalInput = z.infer<typeof NavegarPessoalInput>;

export type PracaNaRota = {
  id: string;
  nome: string;
  rodovia: string | null;
  concessionaria: string | null;
  lat: number;
  lng: number;
};

export type EstimativaFrete = {
  km: number | null;
  /** Só quando `km` é null. */
  erro?: string;
  duracaoMinutos?: number;
  geometria?: string | null;
  pedagios: PracaNaRota[];
  /**
   * `true` = não deu pra checar (sem geometria). Diferente de lista vazia, que
   * é "checei e não passa por praça nenhuma" — a tela não pode dizer "sem
   * pedágio" no primeiro caso.
   */
  pedagiosDesconhecidos?: boolean;
  /** Do histórico DELE (90 dias). Null = ainda não dá pra saber. */
  consumoKmPorLitro: number | null;
  precoLitro: number | null;
  /** Estimativa de diesel do trecho. Null quando falta consumo ou preço. */
  diesel: number | null;
};

/** O período que ele manda pra quem vai pagar. */
export const CriarComprovantePessoalInput = z
  .object({
    /**
     * `FRETES` = o que ele rodou no período (pra quem vai pagar).
     * `CADASTRO` = quem ele é: documentos e validades (pra transportadora que
     * vai liberar a carga). Mesmo mecanismo de link, conteúdo diferente.
     */
    tipo: z.enum(["FRETES", "CADASTRO"]).default("FRETES"),
    inicio: DataSchema,
    fim: DataSchema,
    destinatario: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.inicio <= v.fim, {
    path: ["fim"],
    message: "O fim do período não pode ser antes do começo",
  });
export type CriarComprovantePessoalInput = z.infer<typeof CriarComprovantePessoalInput>;

/**
 * A página pública do comprovante — o que sai pra QUEM NÃO TEM CADASTRO.
 *
 * Montado campo a campo de propósito: vai o nome dele, o período e os fretes.
 * Não vai CPF, telefone, gasto, nem em qual empresa ele roda.
 */
export type ComprovantePessoalPublico = {
  motorista: string;
  destinatario: string | null;
  inicio: string;
  fim: string;
  viagens: {
    data: string;
    origem: string;
    destino: string;
    carga: string | null;
    km: number | null;
    peso: number | null;
    valorRecebido: number | null;
  }[];
  totalKm: number;
  totalRecebido: number;
};
