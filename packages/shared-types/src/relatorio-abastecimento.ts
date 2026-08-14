import { z } from "zod";
import { comPeriodoValido, FormatoExportRelatorio } from "./relatorio";
import { TipoCombustivelEnum } from "./abastecimento";

// Relatório de abastecimentos por período — irmão do relatório de produção
// (relatorio.ts). Mesmo desenho: um recorte, várias dimensões de agrupamento.
//
// Diferenças que NÃO são detalhe:
//   - `Abastecimento.data` é timestamp (a hora importa), não @db.Date como a
//     viagem. A fronteira do dia tem que ancorar em America/Sao_Paulo, senão o
//     recorte come 3h do primeiro dia — ver common/timezone.ts.
//   - `valorTotal` é NULO em abastecimento de comboio (o motorista não soube o
//     valor na hora). Litros existe sempre, valor não; por isso o preço médio
//     divide só pelos litros que têm valor, e o que ficou sem valor é contado à
//     parte em vez de virar zero silencioso.

export const AgruparPorAbastecimento = {
  MOTORISTA: "MOTORISTA",
  VEICULO: "VEICULO",
  EMPRESA: "EMPRESA",
  POSTO: "POSTO",
  TIPO: "TIPO",
  TRANSPORTADORA: "TRANSPORTADORA",
} as const;
export type AgruparPorAbastecimento =
  (typeof AgruparPorAbastecimento)[keyof typeof AgruparPorAbastecimento];

export const AGRUPAR_POR_ABASTECIMENTO_LABEL: Record<AgruparPorAbastecimento, string> = {
  MOTORISTA: "Motorista",
  VEICULO: "Veículo",
  EMPRESA: "Empresa",
  POSTO: "Posto",
  TIPO: "Combustível",
  TRANSPORTADORA: "Frota",
};

export const TIPO_COMBUSTIVEL_LABEL: Record<z.infer<typeof TipoCombustivelEnum>, string> = {
  DIESEL_S10: "Diesel S10",
  DIESEL_S500: "Diesel S500",
  ARLA_32: "Arla 32",
  GASOLINA: "Gasolina",
  ETANOL: "Etanol",
};

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

const filtrosBase = {
  de: ymd,
  ate: ymd,
  motoristaId: z.string().uuid().optional(),
  veiculoId: z.string().uuid().optional(),
  empresaId: z.string().uuid().optional(),
  transportadoraId: z.string().uuid().optional(),
  tipo: TipoCombustivelEnum.optional(),
  /**
   * Nome do posto, comparado sem diferenciar maiúsculas — é texto livre digitado
   * pelo motorista, não FK. Serve pro drill-down de uma linha agrupada por posto.
   */
  posto: z.string().min(1).max(120).optional(),
};

const ordenarPor = z
  .enum(["nome", "abastecimentos", "litros", "valor", "precoMedio"])
  .default("valor");

export const RelatorioAbastecimentosFiltros = comPeriodoValido(z.object(filtrosBase));
export type RelatorioAbastecimentosFiltros = z.infer<typeof RelatorioAbastecimentosFiltros>;

export const RelatorioAbastecimentosQuery = comPeriodoValido(
  z.object({
    ...filtrosBase,
    agruparPor: z.nativeEnum(AgruparPorAbastecimento).default("MOTORISTA"),
    ordenarPor,
    ordem: z.enum(["asc", "desc"]).default("desc"),
  }),
);
export type RelatorioAbastecimentosQuery = z.infer<typeof RelatorioAbastecimentosQuery>;

export const RelatorioAbastecimentosExportQuery = comPeriodoValido(
  z.object({
    ...filtrosBase,
    agruparPor: z.nativeEnum(AgruparPorAbastecimento).default("MOTORISTA"),
    ordenarPor,
    ordem: z.enum(["asc", "desc"]).default("desc"),
    formato: FormatoExportRelatorio,
    incluirDetalhe: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(true),
  }),
);
export type RelatorioAbastecimentosExportQuery = z.infer<typeof RelatorioAbastecimentosExportQuery>;

// Números em STRING (Decimal.toFixed), igual ao relatório de viagens: somar
// milhares de decimais em float acumula deriva de centavos no rodapé.
export type GrupoRelatorioAbastecimentos = {
  chave: string;
  nome: string;
  /** Modelo pro veículo, cidade/UF nada — o que ajuda a identificar a linha. */
  detalhe: string | null;
  abastecimentos: number;
  litros: string;
  valor: string;
  /**
   * R$/litro do grupo = valor ÷ litros COM valor informado. Dividir pelo total
   * de litros faria o comboio (litros sem valor) derrubar o preço médio de
   * quem abastece em posto.
   */
  precoMedio: string;
  /** Litros que entraram na conta do preço médio. */
  litrosComValor: string;
  /** Abastecimentos sem valor informado (comboio ou esquecimento). */
  semValor: number;
  /** Quantos foram marcados como comboio — subconjunto explícito de semValor. */
  emComboio: number;
};

export type TotaisRelatorioAbastecimentos = Omit<
  GrupoRelatorioAbastecimentos,
  "chave" | "nome" | "detalhe"
> & {
  grupos: number;
};

export type RelatorioAbastecimentosResposta = {
  periodo: { de: string; ate: string; dias: number };
  agruparPor: AgruparPorAbastecimento;
  grupos: GrupoRelatorioAbastecimentos[];
  totais: TotaisRelatorioAbastecimentos;
  meta: {
    geradoEm: string;
    linhasProcessadas: number;
  };
};
