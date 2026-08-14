import { z } from "zod";

// Relatório de produção por período. Uma consulta, várias dimensões: o mesmo
// recorte de viagens é agrupado por motorista, cliente, material, local, etc.
//
// Duas regras de negócio moram no service (common/viagem-status.ts e
// common/viagem-minimos.ts) e NÃO se repetem aqui:
//   - STATUS_FORA_FECHAMENTO sempre excluído (viagem sem peso viraria 0t);
//   - toneladas/km saem em DUAS versões, real e efetiva (mínimo aplicado).

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

/**
 * Teto do período. ~13 meses cobre "ano passado inteiro" e ainda deixa margem
 * pra comparar com o mesmo mês do ano anterior. Acima disso o custo da
 * agregação (que é linha a linha, ver relatorios-viagens.service.ts) não se
 * paga — e quem quer 3 anos quer, na prática, um filtro que não colocou.
 */
export const MAX_DIAS_RELATORIO = 400;

export const AgruparPorRelatorio = {
  MOTORISTA: "MOTORISTA",
  CLIENTE: "CLIENTE",
  EMPRESA: "EMPRESA",
  MATERIAL: "MATERIAL",
  LOCAL_CARGA: "LOCAL_CARGA",
  LOCAL_DESCARGA: "LOCAL_DESCARGA",
  VEICULO: "VEICULO",
  TRANSPORTADORA: "TRANSPORTADORA",
} as const;
export type AgruparPorRelatorio = (typeof AgruparPorRelatorio)[keyof typeof AgruparPorRelatorio];

export const AGRUPAR_POR_LABEL: Record<AgruparPorRelatorio, string> = {
  MOTORISTA: "Motorista",
  CLIENTE: "Cliente",
  EMPRESA: "Empresa",
  MATERIAL: "Material",
  LOCAL_CARGA: "Local de carga",
  LOCAL_DESCARGA: "Local de descarga",
  VEICULO: "Veículo",
  TRANSPORTADORA: "Frota",
};

/**
 * Dimensões que expõem a relação comercial Schaba↔cliente. Agrupar por uma
 * delas equivale a listar a carteira, então o endpoint exige
 * `viagens.ver-comercial` — a mesma chave que faz `admin/viagens/comercial.ts`
 * omitir cliente/empresa do payload da listagem.
 */
export const DIMENSOES_COMERCIAIS: AgruparPorRelatorio[] = ["CLIENTE", "EMPRESA"];

/** Chave de grupo usada quando a FK da dimensão é nula (ex.: viagem sem cliente). */
export const GRUPO_SEM_VALOR = "__SEM__";

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000) + 1;

const filtrosBase = {
  de: ymd,
  ate: ymd,
  motoristaId: z.string().uuid().optional(),
  clienteId: z.string().uuid().optional(),
  empresaId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  localCargaId: z.string().uuid().optional(),
  localDescargaId: z.string().uuid().optional(),
  veiculoId: z.string().uuid().optional(),
  transportadoraId: z.string().uuid().optional(),
};

/**
 * As duas regras de período, aplicadas a qualquer schema que tenha `de`/`ate`.
 * Exportado porque o relatório de abastecimentos usa exatamente as mesmas —
 * duas cópias divergiriam no dia em que MAX_DIAS mudar.
 *
 * O genérico é `z.ZodType<Out, _, In>` e NÃO `z.ZodTypeAny`: com `ZodTypeAny`,
 * o `.refine` do zod devolve `ZodEffects<T, any, any>` e todo `z.infer` daqui
 * pra baixo vira `any` — o que apagava a checagem de tipo de todas as querys de
 * relatório (`q.agruparPor`, `q.formato`…) sem um único erro de compilação.
 */
export const comPeriodoValido = <Out extends { de: string; ate: string }, In>(
  schema: z.ZodType<Out, z.ZodTypeDef, In>,
): z.ZodType<Out, z.ZodTypeDef, In> =>
  schema
    .refine((f) => f.de <= f.ate, {
      message: "A data final não pode ser antes da inicial.",
      path: ["ate"],
    })
    .refine((f) => diasEntre(f.de, f.ate) <= MAX_DIAS_RELATORIO, {
      message: `Período máximo de ${MAX_DIAS_RELATORIO} dias. Reduza o intervalo ou aplique um filtro.`,
      path: ["de"],
    });

// `de` e `ate` são OBRIGATÓRIOS aqui, ao contrário da listagem de viagens:
// relatório sem período é um full scan disfarçado de conveniência.
export const RelatorioViagensFiltros = comPeriodoValido(z.object(filtrosBase));
export type RelatorioViagensFiltros = z.infer<typeof RelatorioViagensFiltros>;

export const RelatorioViagensQuery = comPeriodoValido(
  z.object({
    ...filtrosBase,
    agruparPor: z.nativeEnum(AgruparPorRelatorio).default("MOTORISTA"),
    ordenarPor: z
      .enum(["nome", "viagens", "toneladas", "toneladasEfetiva", "km", "kmEfetivo", "pedagio"])
      .default("viagens"),
    ordem: z.enum(["asc", "desc"]).default("desc"),
  }),
);
export type RelatorioViagensQuery = z.infer<typeof RelatorioViagensQuery>;

export const FormatoExportRelatorio = z.enum(["xlsx", "pdf"]);
export type FormatoExportRelatorio = z.infer<typeof FormatoExportRelatorio>;

export const RelatorioViagensExportQuery = comPeriodoValido(
  z.object({
    ...filtrosBase,
    agruparPor: z.nativeEnum(AgruparPorRelatorio).default("MOTORISTA"),
    ordenarPor: z
      .enum(["nome", "viagens", "toneladas", "toneladasEfetiva", "km", "kmEfetivo", "pedagio"])
      .default("viagens"),
    ordem: z.enum(["asc", "desc"]).default("desc"),
    formato: FormatoExportRelatorio,
    // O detalhe viagem a viagem vai numa 2ª aba do XLSX. No PDF é opcional
    // porque milhares de linhas viram um documento que ninguém lê.
    incluirDetalhe: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((v) => v === true || v === "true")
      .default(true),
  }),
);
export type RelatorioViagensExportQuery = z.infer<typeof RelatorioViagensExportQuery>;

// Números saem como STRING (Decimal.toFixed) pelo mesmo motivo do resto da API:
// somar dezenas de milhares de decimais em float acumula deriva de centavos, e
// o cliente confere o rodapé na mão.
export type GrupoRelatorioViagens = {
  chave: string;
  nome: string;
  /** Cidade/UF pra local, placa/modelo pra veículo, empresa pra cliente. */
  detalhe: string | null;
  viagens: number;
  toneladas: string;
  km: string;
  pedagio: string;
  /** Viagens com `valorPedagioTotal` nulo ou zero — denuncia subnotificação. */
  viagensSemPedagio: number;
  /**
   * Viagens que contam como PRODUÇÃO aqui mas que o XLSX de fechamento não
   * manda pro cliente (DIVERGENTE, EM_CONFERENCIA, RASCUNHO_OFFLINE — o export
   * só aceita ENVIADA/OK/AJUSTADA). É a explicação de por que este total pode
   * ser maior que o do fechamento do mesmo período; sem expor isso, a diferença
   * vira suspeita de bug.
   */
  viagensNaoConciliadas: number;
  // Campos comerciais: SOMEM do JSON sem `viagens.ver-comercial`.
  toneladasEfetiva?: string;
  toneladasAjustadas?: number;
  kmEfetivo?: string;
  kmAjustados?: number;
};

export type TotaisRelatorioViagens = Omit<GrupoRelatorioViagens, "chave" | "nome" | "detalhe"> & {
  grupos: number;
};

export type RelatorioViagensResposta = {
  periodo: { de: string; ate: string; dias: number };
  agruparPor: AgruparPorRelatorio;
  /** false = o payload veio sem as colunas de mínimo faturado. */
  comercial: boolean;
  grupos: GrupoRelatorioViagens[];
  totais: TotaisRelatorioViagens;
  /**
   * Pedágio tem DUAS fontes que nunca foram sincronizadas: o total digitado na
   * viagem (que é o que o fechamento fatura, e é o que vira `totais.pedagio`) e
   * os lançamentos praça a praça da tabela `pedagios`, que o PWA grava. Somar
   * as duas conta o mesmo pedágio duas vezes — por isso os lançamentos vêm
   * aqui, rotulados, e nunca dentro do total.
   */
  pedagioReconciliacao: {
    lancamentosVinculados: string;
    lancamentosAvulsos: string;
  };
  meta: {
    geradoEm: string;
    linhasProcessadas: number;
    regrasMinimoAtivas: number;
  };
};
