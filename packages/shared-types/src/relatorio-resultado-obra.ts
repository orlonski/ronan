import { z } from "zod";
import { comPeriodoValido, FormatoExportRelatorio } from "./relatorio";

// Resultado por obra: o que cada obra (Cliente) rendeu menos o que custou levar
// a carga dela no período. A regra mora em apps/api/src/common/resultado-obra.ts
// e parte do MESMO cálculo do lucro por caminhão — a soma das obras, das viagens
// sem obra e do caminhão parado fecha com o total da frota daquele relatório.
//
// Números em STRING (Decimal.toFixed), como nos outros relatórios.

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

const filtrosBase = {
  de: ymd,
  ate: ymd,
  /** Cliente pagador (Empresa). Filtra as LINHAS; o rateio considera a frota toda. */
  empresaId: z.string().uuid().optional(),
  transportadoraId: z.string().uuid().optional(),
};

export const RelatorioResultadoObraQuery = comPeriodoValido(z.object(filtrosBase));
export type RelatorioResultadoObraQuery = z.infer<typeof RelatorioResultadoObraQuery>;

export const RelatorioResultadoObraExportQuery = comPeriodoValido(
  z.object({ ...filtrosBase, formato: FormatoExportRelatorio }),
);
export type RelatorioResultadoObraExportQuery = z.infer<typeof RelatorioResultadoObraExportQuery>;

/** Chave da linha "viagens sem obra" no detalhe. */
export const OBRA_SEM_OBRA = "sem-obra";

export const RelatorioResultadoObraDetalheQuery = comPeriodoValido(
  z.object({
    ...filtrosBase,
    /** `Cliente.id` da obra, ou `sem-obra`. */
    obra: z.union([z.string().uuid(), z.literal(OBRA_SEM_OBRA)]),
  }),
);
export type RelatorioResultadoObraDetalheQuery = z.infer<typeof RelatorioResultadoObraDetalheQuery>;

/**
 * Composição do custo. `motorista` e `pedagio` (o da própria viagem) são
 * DIRETOS: cada viagem sabe o seu. O resto é do caminhão e chega à obra
 * rateado pelo km que ela rodou nele — o mesmo "por km" do lucro por caminhão.
 * `pedagio + pedagioAvulso` = o pedágio do lucro por caminhão.
 */
export type CustosObra = {
  motorista: string;
  pedagio: string;
  combustivel: string;
  pedagioAvulso: string;
  manutencao: string;
  multas: string;
  custosFixos: string;
  outrasContas: string;
};

export type ReceitaObra = {
  /** Frete (ViagemValor, já com mínimo e preço). */
  frete: string;
  /** Pedágio repassado ao cliente dentro do valor da viagem. */
  pedagio: string;
  /** Estadia que entrou numa fatura viva, ligada à viagem. */
  estadia: string;
  total: string;
};

export type ParPorUnidade = { receita: string; custo: string; margem: string };

export type AvisosObra = {
  /** Viagens sem preço: entram no custo, NÃO na receita. */
  viagensSemPreco: number;
  viagensSemCustoMotorista: number;
  viagensEmpregado: number;
};

export type ViagemResultadoObra = {
  id: string;
  data: string;
  ticket: string | null;
  placa: string;
  toneladas: string;
  km: string;
  semPreco: boolean;
  receita: string;
  custoDireto: string;
  custoRateado: string;
  custo: string;
  margem: string;
};

export type LinhaResultadoObra = {
  /** `Cliente.id`, ou `sem-obra`. */
  chave: string;
  clienteId: string | null;
  obra: string;
  empresaId: string | null;
  empresa: string | null;
  viagens: number;
  toneladas: string;
  km: string;
  receita: ReceitaObra;
  custos: CustosObra;
  custoDireto: string;
  custoRateado: string;
  custo: string;
  margem: string;
  /** Margem ÷ receita, em %. Null sem receita. */
  margemPct: number | null;
  porTonelada: ParPorUnidade | null;
  porViagem: ParPorUnidade | null;
  /** As viagens sem preço, à parte: quantas e quanto custaram (já dentro do custo). */
  semPreco: { viagens: number; toneladas: string; custo: string };
  avisos: AvisosObra;
};

export type LinhaResultadoObraDetalhe = LinhaResultadoObra & { viagensLista: ViagemResultadoObra[] };

export type CaminhaoParado = { veiculoId: string; placa: string; custo: string };

export type RelatorioResultadoObraResposta = {
  periodo: { de: string; ate: string };
  /** Pior margem primeiro: é onde o dinheiro está vazando. */
  obras: LinhaResultadoObra[];
  /** Viagens sem obra cadastrada. Null quando não há (ou quando filtrado por cliente). */
  semObra: LinhaResultadoObra | null;
  /**
   * Custo de caminhão que não rodou nenhuma viagem no período: não há obra pra
   * carregar. Fica à vista pra soma fechar. Null quando filtrado por cliente.
   */
  parado: { custo: string; custos: CustosObra; caminhoes: CaminhaoParado[] } | null;
  total: {
    obras: number;
    viagens: number;
    toneladas: string;
    km: string;
    receita: ReceitaObra;
    custos: CustosObra;
    custo: string;
    margem: string;
    margemPct: number | null;
    semPreco: { viagens: number; toneladas: string; custo: string };
    avisos: AvisosObra;
  };
  /**
   * O total do lucro por caminhão no mesmo período e recorte, pra conferir.
   * Null quando filtrado por cliente (aí não há o que fechar).
   */
  conferencia: { faturouLucro: string; gastouLucro: string } | null;
};
