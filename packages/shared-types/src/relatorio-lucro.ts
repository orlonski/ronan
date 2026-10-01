import { z } from "zod";
import { comPeriodoValido, FormatoExportRelatorio } from "./relatorio";

// Lucro por caminhão: o que cada caminhão faturou menos o que a empresa gastou
// com ele no período. A regra mora em apps/api/src/common/lucro-veiculo.ts.
//
// Números em STRING (Decimal.toFixed), como nos outros relatórios: dinheiro
// somado em float acumula deriva de centavos no rodapé.

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato AAAA-MM-DD.");

const filtrosBase = {
  de: ymd,
  ate: ymd,
  transportadoraId: z.string().uuid().optional(),
};

export const RelatorioLucroQuery = comPeriodoValido(z.object(filtrosBase));
export type RelatorioLucroQuery = z.infer<typeof RelatorioLucroQuery>;

export const RelatorioLucroExportQuery = comPeriodoValido(
  z.object({ ...filtrosBase, formato: FormatoExportRelatorio }),
);
export type RelatorioLucroExportQuery = z.infer<typeof RelatorioLucroExportQuery>;

export type CustosLucro = {
  motorista: string;
  combustivel: string;
  pedagio: string;
  manutencao: string;
  multas: string;
  custosFixos: string;
  outrasContas: string;
};

export type AvisosLucro = {
  /** Viagens sem preço cadastrado: o faturado está menor do que é. */
  viagensSemPreco: number;
  /** A régua do motorista não cobre a viagem (sem modalidade, sem valor). */
  viagensSemCustoMotorista: number;
  /** Motorista empregado no dia: salário entra como custo fixo do caminhão. */
  viagensEmpregado: number;
  abastecimentosEstimados: number;
  abastecimentosSemPreco: number;
  manutencoesSemValor: number;
};

export type ItemDespesaLucro = {
  id: string;
  data: string;
  descricao: string;
  valor: string | null;
};

export type ItemCustoFixoLucro = {
  id: string;
  tipo: string;
  valorMensal: string;
  valorNoPeriodo: string;
};

export type PorKmLucro = {
  faturou: string;
  gastou: string;
  sobrou: string;
  custos: Record<keyof CustosLucro, string>;
};

export type LinhaLucroVeiculo = {
  veiculoId: string;
  placa: string;
  modelo: string | null;
  viagens: number;
  /** Km das viagens que entraram. */
  km: string;
  /** Tudo dividido pelo km. Null sem km. */
  porKm: PorKmLucro | null;
  faturou: string;
  custos: CustosLucro;
  gastou: string;
  sobrou: string;
  /** Sobrou ÷ faturou, em %. Null quando não faturou nada. */
  margem: number | null;
  /** Pago pelo motorista do próprio bolso, sem reembolso. Não entra na conta. */
  foraDaConta: { combustivel: string; pedagio: string };
  avisos: AvisosLucro;
  detalhe: {
    manutencoes: ItemDespesaLucro[];
    multas: ItemDespesaLucro[];
    outrasContas: ItemDespesaLucro[];
    custosFixos: ItemCustoFixoLucro[];
  };
};

export type RelatorioLucroResposta = {
  periodo: { de: string; ate: string };
  /** Menor "sobrou" primeiro: é onde o dinheiro está vazando. */
  veiculos: LinhaLucroVeiculo[];
  frota: {
    veiculos: number;
    viagens: number;
    km: string;
    porKm: PorKmLucro | null;
    faturou: string;
    gastou: string;
    sobrou: string;
    margem: number | null;
    custos: CustosLucro;
    foraDaConta: { combustivel: string; pedagio: string };
    avisos: AvisosLucro;
  };
};
