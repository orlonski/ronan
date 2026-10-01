import { Prisma } from "@prisma/client";
import {
  pedagioDaViagem,
  remuneracaoDaViagem,
  type RegraRemuneracao,
  type ViagemParaAcerto,
} from "./acerto-motorista";

/**
 * Quanto cada caminhão deu de lucro no período: o que faturou menos o que a
 * EMPRESA gastou com ele.
 *
 * Função pura de propósito. Quem busca no banco é o service; aqui só se decide
 * o que conta, e essa decisão tem armadilha suficiente pra merecer teste:
 *
 *   - O faturado é o `ViagemValor.valorTotal`, que já saiu do mínimo e depois
 *     do preço. Aqui ninguém recalcula preço: refazer a conta seria abrir a
 *     porta pra ela divergir da fatura.
 *   - O pedágio da viagem vem de UMA fonte só (`pedagioDaViagem`). Somar
 *     `valorPedagioTotal` com `Pedagio.valor` é o pedágio em dobro.
 *   - O custo do motorista é o que já entrou no acerto (congelado) quando
 *     entrou; senão, a régua dele. Bônus e desconto do acerto ficam fora: são
 *     da pessoa, não do caminhão.
 *   - Combustível e pedágio só são custo da empresa quando ELA pagou: comboio,
 *     ou modalidade que devolve ao motorista, ou dia em que ele era empregado.
 *     O que o parceiro pagou do bolso sem reembolso não some: vai pra
 *     `foraDaConta`, pra quem olha conseguir conferir a escolha.
 *
 * Dado faltando nunca vira zero calado: viagem sem preço, viagem sem régua,
 * comboio sem preço e manutenção sem valor são CONTADOS, e a tela avisa.
 */

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

function dec(v: DecimalLike): Prisma.Decimal {
  if (v == null) return new Prisma.Decimal(0);
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

const ZERO = () => new Prisma.Decimal(0);

export type ViagemParaLucro = ViagemParaAcerto & {
  /** `ViagemValor.valorTotal` (frete + pedágio cobrado do cliente). Null = sem preço. */
  valorTotal: DecimalLike;
  /** Valor do item FRETE do acerto, quando a viagem já entrou num. Vence a régua. */
  freteAcertado: DecimalLike;
  /**
   * A régua do motorista. Null = ele era empregado registrado no dia da viagem:
   * o que ele recebe é salário, e salário entra como custo fixo do caminhão.
   */
  regra: RegraRemuneracao | null;
};

export type AbastecimentoParaLucro = {
  id: string;
  tipo: string;
  litros: DecimalLike;
  valorTotal: DecimalLike;
  emComboio: boolean;
  /** A empresa pagou (modalidade devolve, ou ele era empregado no dia). Comboio ignora isto. */
  empresaPaga: boolean;
};

export type PedagioAvulsoParaLucro = {
  id: string;
  valor: DecimalLike;
  empresaPaga: boolean;
};

/** Manutenção, multa ou conta a pagar: algo com data, descrição e valor. */
export type DespesaParaLucro = {
  id: string;
  data: Date;
  descricao: string;
  /** Null = lançada sem valor (manutenção concluída sem conta). Contada à parte. */
  valor: DecimalLike;
};

export type CustoFixoParaLucro = {
  id: string;
  tipo: string;
  valorMensal: DecimalLike;
  vigenciaDe: Date;
  vigenciaAte: Date | null;
};

export type EntradaLucroVeiculo = {
  /** Período, em AAAA-MM-DD (dia civil de Brasília). */
  de: string;
  ate: string;
  viagens: ViagemParaLucro[];
  abastecimentos: AbastecimentoParaLucro[];
  pedagiosAvulsos: PedagioAvulsoParaLucro[];
  manutencoes: DespesaParaLucro[];
  multas: DespesaParaLucro[];
  outrasContas: DespesaParaLucro[];
  custosFixos: CustoFixoParaLucro[];
  /**
   * Preço médio do litro da conta no período, por tipo de combustível. Serve
   * pro abastecimento sem valor (o comboio, quase sempre): sem ele, o diesel do
   * caminhão-tanque sairia de graça e o caminhão pareceria mais lucrativo.
   */
  precoMedioLitro: Record<string, DecimalLike>;
};

export type ItemDespesa = { id: string; data: string; descricao: string; valor: string | null };
export type ItemCustoFixo = { id: string; tipo: string; valorMensal: string; valorNoPeriodo: string };

export type LucroVeiculo = {
  viagens: number;
  faturou: string;
  custos: {
    motorista: string;
    combustivel: string;
    pedagio: string;
    manutencao: string;
    multas: string;
    custosFixos: string;
    outrasContas: string;
  };
  gastou: string;
  sobrou: string;
  /** Sobrou ÷ faturou, em %. Null quando não faturou nada (dividir por zero não é margem). */
  margem: number | null;
  /** O que o motorista pagou do bolso sem reembolso. Não entra na conta; está aqui pra conferir. */
  foraDaConta: { combustivel: string; pedagio: string };
  avisos: {
    viagensSemPreco: number;
    viagensSemCustoMotorista: number;
    viagensEmpregado: number;
    /** Combustível cujo valor foi estimado pelo preço médio (comboio sem valor). */
    abastecimentosEstimados: number;
    /** Sem valor e sem preço médio pra estimar: não entrou. */
    abastecimentosSemPreco: number;
    manutencoesSemValor: number;
  };
  detalhe: {
    manutencoes: ItemDespesa[];
    multas: ItemDespesa[];
    outrasContas: ItemDespesa[];
    custosFixos: ItemCustoFixo[];
  };
};

const fmtDia = (d: Date) => d.toISOString().slice(0, 10);

function diaUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function diasNoMes(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Quanto de um custo MENSAL cai dentro do período.
 *
 * Dia a dia, cada dia valendo 1/(dias daquele mês): o mês cheio dá exatamente o
 * valor mensal, seja fevereiro ou julho, e um período que atravessa dois meses
 * soma a fração certa de cada um. Rateio por 30 dias fixos faria julho inteiro
 * custar 103% do mensal.
 */
export function custoFixoNoPeriodo(c: CustoFixoParaLucro, de: string, ate: string): Prisma.Decimal {
  const inicioPeriodo = diaUtc(de).getTime();
  const fimPeriodo = diaUtc(ate).getTime();
  const inicio = Math.max(inicioPeriodo, Date.UTC(
    c.vigenciaDe.getUTCFullYear(), c.vigenciaDe.getUTCMonth(), c.vigenciaDe.getUTCDate(),
  ));
  const fim = c.vigenciaAte
    ? Math.min(fimPeriodo, Date.UTC(
        c.vigenciaAte.getUTCFullYear(), c.vigenciaAte.getUTCMonth(), c.vigenciaAte.getUTCDate(),
      ))
    : fimPeriodo;
  if (fim < inicio) return ZERO();

  const mensal = dec(c.valorMensal);
  let total = ZERO();
  for (let t = inicio; t <= fim; t += 86_400_000) {
    total = total.add(mensal.div(diasNoMes(new Date(t))));
  }
  return total;
}

function somaDespesas(itens: DespesaParaLucro[]): { total: Prisma.Decimal; semValor: number } {
  let total = ZERO();
  let semValor = 0;
  for (const i of itens) {
    if (i.valor == null) {
      semValor++;
      continue;
    }
    total = total.add(dec(i.valor));
  }
  return { total, semValor };
}

function itemDespesa(i: DespesaParaLucro): ItemDespesa {
  return {
    id: i.id,
    data: fmtDia(i.data),
    descricao: i.descricao,
    valor: i.valor == null ? null : dec(i.valor).toFixed(2),
  };
}

export function calcularLucroVeiculo(e: EntradaLucroVeiculo): LucroVeiculo {
  let faturou = ZERO();
  let motorista = ZERO();
  let pedagio = ZERO();
  let pedagioFora = ZERO();
  let viagensSemPreco = 0;
  let viagensSemCustoMotorista = 0;
  let viagensEmpregado = 0;

  for (const v of e.viagens) {
    if (v.valorTotal == null) viagensSemPreco++;
    else faturou = faturou.add(dec(v.valorTotal));

    if (v.regra == null) {
      viagensEmpregado++;
    } else if (v.freteAcertado != null) {
      motorista = motorista.add(dec(v.freteAcertado));
    } else {
      const r = remuneracaoDaViagem(v, v.regra);
      if ("valor" in r) motorista = motorista.add(r.valor);
      // Percentual de frete sem preço é a MESMA falta da viagem sem preço:
      // contar de novo mandaria a pessoa mexer na modalidade, que está certa.
      else if (!(v.regra.tipo === "PERCENTUAL_FRETE" && v.valorTotal == null)) {
        viagensSemCustoMotorista++;
      }
    }

    const { valor } = pedagioDaViagem(v);
    if (v.regra == null || v.regra.reembolsaPedagio) pedagio = pedagio.add(valor);
    else pedagioFora = pedagioFora.add(valor);
  }

  for (const p of e.pedagiosAvulsos) {
    if (p.empresaPaga) pedagio = pedagio.add(dec(p.valor));
    else pedagioFora = pedagioFora.add(dec(p.valor));
  }

  let combustivel = ZERO();
  let combustivelFora = ZERO();
  let abastecimentosEstimados = 0;
  let abastecimentosSemPreco = 0;
  for (const a of e.abastecimentos) {
    // Comboio é diesel da empresa por definição, independente da régua.
    const daEmpresa = a.emComboio || a.empresaPaga;
    let valor: Prisma.Decimal | null = null;
    if (a.valorTotal != null && dec(a.valorTotal).gt(0)) {
      valor = dec(a.valorTotal);
    } else {
      const preco = e.precoMedioLitro[a.tipo];
      if (preco != null && dec(preco).gt(0)) {
        valor = dec(a.litros).mul(dec(preco));
        if (daEmpresa) abastecimentosEstimados++;
      } else if (daEmpresa) {
        abastecimentosSemPreco++;
      }
    }
    if (valor == null) continue;
    if (daEmpresa) combustivel = combustivel.add(valor);
    else combustivelFora = combustivelFora.add(valor);
  }

  const manut = somaDespesas(e.manutencoes);
  const multas = somaDespesas(e.multas);
  const outras = somaDespesas(e.outrasContas);

  let custosFixos = ZERO();
  const custosFixosDetalhe: ItemCustoFixo[] = [];
  for (const c of e.custosFixos) {
    const noPeriodo = custoFixoNoPeriodo(c, e.de, e.ate);
    if (noPeriodo.lte(0)) continue;
    custosFixos = custosFixos.add(noPeriodo);
    custosFixosDetalhe.push({
      id: c.id,
      tipo: c.tipo,
      valorMensal: dec(c.valorMensal).toFixed(2),
      valorNoPeriodo: noPeriodo.toFixed(2),
    });
  }

  const gastou = motorista
    .add(combustivel)
    .add(pedagio)
    .add(manut.total)
    .add(multas.total)
    .add(custosFixos)
    .add(outras.total);
  // Arredonda as parcelas antes de subtrair: a tela mostra parcelas com 2
  // casas, e o "sobrou" tem que fechar com a conta que a pessoa faz de cabeça.
  const faturou2 = new Prisma.Decimal(faturou.toFixed(2));
  const gastou2 = new Prisma.Decimal(gastou.toFixed(2));
  const sobrou = faturou2.sub(gastou2);

  return {
    viagens: e.viagens.length,
    faturou: faturou2.toFixed(2),
    custos: {
      motorista: motorista.toFixed(2),
      combustivel: combustivel.toFixed(2),
      pedagio: pedagio.toFixed(2),
      manutencao: manut.total.toFixed(2),
      multas: multas.total.toFixed(2),
      custosFixos: custosFixos.toFixed(2),
      outrasContas: outras.total.toFixed(2),
    },
    gastou: gastou2.toFixed(2),
    sobrou: sobrou.toFixed(2),
    margem: faturou2.gt(0) ? Number(sobrou.div(faturou2).mul(100).toFixed(1)) : null,
    foraDaConta: { combustivel: combustivelFora.toFixed(2), pedagio: pedagioFora.toFixed(2) },
    avisos: {
      viagensSemPreco,
      viagensSemCustoMotorista,
      viagensEmpregado,
      abastecimentosEstimados,
      abastecimentosSemPreco,
      manutencoesSemValor: manut.semValor,
    },
    detalhe: {
      manutencoes: e.manutencoes.map(itemDespesa),
      multas: e.multas.map(itemDespesa),
      outrasContas: e.outrasContas.map(itemDespesa),
      custosFixos: custosFixosDetalhe,
    },
  };
}
