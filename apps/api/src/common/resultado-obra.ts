import { Prisma } from "@prisma/client";
import {
  OBRA_SEM_OBRA,
  type AvisosObra,
  type CaminhaoParado,
  type CustosObra,
  type LinhaResultadoObraDetalhe,
  type ParPorUnidade,
  type ReceitaObra,
  type RelatorioResultadoObraResposta,
  type ViagemResultadoObra,
} from "@ronan/shared-types";
import {
  calcularLucroVeiculo,
  custoMotoristaDaViagem,
  pedagioDaViagemNaConta,
  type EntradaLucroVeiculo,
  type ViagemParaLucro,
} from "./lucro-veiculo";

/**
 * Resultado por obra: o que cada obra rendeu menos o que custou levar a carga
 * dela.
 *
 * NÃO é uma conta nova. Parte do `calcularLucroVeiculo` de cada caminhão e só
 * REDISTRIBUI o que ele já decidiu entre as viagens do caminhão:
 *
 *   - Direto (cada viagem sabe o seu): o motorista (`custoMotoristaDaViagem`,
 *     a mesma régua/acerto do lucro) e o pedágio da viagem
 *     (`pedagioDaViagemNaConta`, UMA fonte só — a armadilha do pedágio em
 *     dobro mora lá, não aqui).
 *   - Rateado pelo km que a viagem rodou no caminhão: combustível, pedágio
 *     avulso, manutenção, multas, custos fixos e outras contas. Km porque é a
 *     régua que o lucro por caminhão já usa (custo/km); por dia de uso daria
 *     o mesmo peso a uma viagem de 5 km e a uma de 300 km no mesmo dia, e o
 *     diesel não funciona assim.
 *   - Caminhão sem nenhuma viagem no período não tem obra pra carregar o custo
 *     dele: vira "parado", à vista.
 *
 * Cada parcela do caminhão é repartida em CENTAVOS (maior resto), então a
 * soma das obras + sem obra + parado fecha, categoria por categoria, com o
 * lucro por caminhão — sem deriva de arredondamento no rodapé.
 *
 * Viagem sem preço entra no custo (o caminhão rodou, o motorista ganhou) e
 * NÃO na receita — e é contada à parte, com quanto custou, pra nunca virar
 * "receita zero" silenciosa que derruba a margem sem explicar.
 *
 * Única receita que o lucro por caminhão não tem: a estadia faturada. Ela vai
 * separada em `receita.estadia`; frete + pedágio repassado fecham com o
 * "faturou" do lucro.
 */

type DecimalLike = Prisma.Decimal | string | number | null | undefined;

const dec = (v: DecimalLike): Prisma.Decimal =>
  v == null ? new Prisma.Decimal(0) : v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
const ZERO = () => new Prisma.Decimal(0);

export type ObraDaViagem = { clienteId: string; obra: string; empresaId: string; empresa: string };

export type ViagemParaResultado = ViagemParaLucro & {
  /** Null = viagem sem obra (cliente) cadastrada. */
  obra: ObraDaViagem | null;
  /** `ViagemValor.valorPedagio`: o pedágio repassado, que já está no `valorTotal`. */
  pedagioCobrado: DecimalLike;
  /** Estadia desta viagem que entrou numa fatura viva. */
  estadia: DecimalLike;
};

export type CaminhaoParaResultado = {
  veiculoId: string;
  placa: string;
  entrada: EntradaLucroVeiculo & { viagens: ViagemParaResultado[] };
};

const CHAVES_CUSTO: (keyof CustosObra)[] = [
  "motorista",
  "pedagio",
  "combustivel",
  "pedagioAvulso",
  "manutencao",
  "multas",
  "custosFixos",
  "outrasContas",
];
const DIRETOS: (keyof CustosObra)[] = ["motorista", "pedagio"];

/**
 * Reparte `total` (2 casas) proporcional a `pesos`, em centavos inteiros, pelo
 * maior resto: a soma das partes é EXATAMENTE o total. Pesos todos zero = partes
 * iguais (caminhão que rodou viagens sem km cadastrado ainda tem que carregar
 * o custo em algum lugar).
 */
export function ratearCentavos(total: DecimalLike, pesos: DecimalLike[]): Prisma.Decimal[] {
  const n = pesos.length;
  if (n === 0) return [];
  const t = dec(total);
  const negativo = t.lt(0);
  const centavos = t.abs().mul(100).toDecimalPlaces(0);
  let ps = pesos.map((p) => Prisma.Decimal.max(dec(p), 0));
  let soma = ps.reduce((a, p) => a.add(p), ZERO());
  if (soma.isZero()) {
    ps = ps.map(() => new Prisma.Decimal(1));
    soma = new Prisma.Decimal(n);
  }
  const brutos = ps.map((p) => centavos.mul(p).div(soma));
  const pisos = brutos.map((b) => b.floor());
  let sobra = centavos.sub(pisos.reduce((a, p) => a.add(p), ZERO())).toNumber();
  const ordem = brutos
    .map((b, i) => ({ i, resto: b.sub(pisos[i]!) }))
    .sort((a, b) => b.resto.cmp(a.resto) || a.i - b.i);
  for (const { i } of ordem) {
    if (sobra <= 0) break;
    pisos[i] = pisos[i]!.add(1);
    sobra--;
  }
  return pisos.map((c) => {
    const v = c.div(100);
    return negativo ? v.neg() : v;
  });
}

type Acum = {
  chave: string;
  clienteId: string | null;
  obra: string;
  empresaId: string | null;
  empresa: string | null;
  viagens: number;
  toneladas: Prisma.Decimal;
  km: Prisma.Decimal;
  frete: Prisma.Decimal;
  pedagioCobrado: Prisma.Decimal;
  estadia: Prisma.Decimal;
  custos: Record<keyof CustosObra, Prisma.Decimal>;
  semPreco: { viagens: number; toneladas: Prisma.Decimal; custo: Prisma.Decimal };
  avisos: AvisosObra;
  lista: ViagemResultadoObra[];
};

const custosZerados = () =>
  Object.fromEntries(CHAVES_CUSTO.map((k) => [k, ZERO()])) as Record<keyof CustosObra, Prisma.Decimal>;

const somaCustos = (c: Record<keyof CustosObra, Prisma.Decimal>, chaves = CHAVES_CUSTO) =>
  chaves.reduce((a, k) => a.add(c[k]), ZERO());

const custosTexto = (c: Record<keyof CustosObra, Prisma.Decimal>): CustosObra =>
  Object.fromEntries(CHAVES_CUSTO.map((k) => [k, c[k].toFixed(2)])) as CustosObra;

function porUnidade(qtd: Prisma.Decimal, receita: Prisma.Decimal, custo: Prisma.Decimal): ParPorUnidade | null {
  if (qtd.lte(0)) return null;
  return {
    receita: receita.div(qtd).toFixed(2),
    custo: custo.div(qtd).toFixed(2),
    margem: receita.sub(custo).div(qtd).toFixed(2),
  };
}

const margemPct = (margem: Prisma.Decimal, receita: Prisma.Decimal): number | null =>
  receita.gt(0) ? Number(margem.div(receita).mul(100).toFixed(1)) : null;

function fecharLinha(a: Acum): LinhaResultadoObraDetalhe {
  const receitaTotal = a.frete.add(a.pedagioCobrado).add(a.estadia);
  const custo = somaCustos(a.custos);
  const custoDireto = somaCustos(a.custos, DIRETOS);
  const margem = receitaTotal.sub(custo);
  const receita: ReceitaObra = {
    frete: a.frete.toFixed(2),
    pedagio: a.pedagioCobrado.toFixed(2),
    estadia: a.estadia.toFixed(2),
    total: receitaTotal.toFixed(2),
  };
  return {
    chave: a.chave,
    clienteId: a.clienteId,
    obra: a.obra,
    empresaId: a.empresaId,
    empresa: a.empresa,
    viagens: a.viagens,
    toneladas: a.toneladas.toFixed(3),
    km: a.km.toFixed(0),
    receita,
    custos: custosTexto(a.custos),
    custoDireto: custoDireto.toFixed(2),
    custoRateado: custo.sub(custoDireto).toFixed(2),
    custo: custo.toFixed(2),
    margem: margem.toFixed(2),
    margemPct: margemPct(margem, receitaTotal),
    porTonelada: porUnidade(a.toneladas, receitaTotal, custo),
    porViagem: porUnidade(new Prisma.Decimal(a.viagens), receitaTotal, custo),
    semPreco: {
      viagens: a.semPreco.viagens,
      toneladas: a.semPreco.toneladas.toFixed(3),
      custo: a.semPreco.custo.toFixed(2),
    },
    avisos: a.avisos,
    viagensLista: a.lista.sort((x, y) => x.data.localeCompare(y.data) || x.id.localeCompare(y.id)),
  };
}

export type ResultadoObrasCalculado = Omit<RelatorioResultadoObraResposta, "periodo" | "obras" | "semObra"> & {
  obras: LinhaResultadoObraDetalhe[];
  semObra: LinhaResultadoObraDetalhe | null;
};

/**
 * @param empresaId Cliente pagador: filtra as LINHAS devolvidas. O rateio
 *   sempre usa todas as viagens do caminhão — senão a obra filtrada carregaria
 *   sozinha o custo inteiro de um caminhão que também rodou pra outros.
 */
export function calcularResultadoObras(
  caminhoes: CaminhaoParaResultado[],
  empresaId?: string,
): ResultadoObrasCalculado {
  const porObra = new Map<string, Acum>();
  const paradoCustos = custosZerados();
  const parados: CaminhaoParado[] = [];
  let faturouLucro = ZERO();
  let gastouLucro = ZERO();

  const acumDe = (o: ObraDaViagem | null): Acum => {
    const chave = o?.clienteId ?? OBRA_SEM_OBRA;
    let a = porObra.get(chave);
    if (!a) {
      a = {
        chave,
        clienteId: o?.clienteId ?? null,
        obra: o?.obra ?? "Sem obra",
        empresaId: o?.empresaId ?? null,
        empresa: o?.empresa ?? null,
        viagens: 0,
        toneladas: ZERO(),
        km: ZERO(),
        frete: ZERO(),
        pedagioCobrado: ZERO(),
        estadia: ZERO(),
        custos: custosZerados(),
        semPreco: { viagens: 0, toneladas: ZERO(), custo: ZERO() },
        avisos: { viagensSemPreco: 0, viagensSemCustoMotorista: 0, viagensEmpregado: 0 },
        lista: [],
      };
      porObra.set(chave, a);
    }
    return a;
  };

  for (const c of caminhoes) {
    const lucro = calcularLucroVeiculo(c.entrada);
    faturouLucro = faturouLucro.add(lucro.faturou);
    gastouLucro = gastouLucro.add(lucro.gastou);

    const vs: ViagemParaResultado[] = c.entrada.viagens;
    const motoristas = vs.map((v) => custoMotoristaDaViagem(v));
    const pedagiosViagem = vs.map((v) => pedagioDaViagemNaConta(v).empresa);
    const pedagioViagemTotal = new Prisma.Decimal(
      pedagiosViagem.reduce((a, p) => a.add(p), ZERO()).toFixed(2),
    );
    // As parcelas do caminhão como o lucro as mostra (2 casas). O pedágio do
    // lucro junta o da viagem e o avulso; aqui eles se separam porque um é
    // direto e o outro é rateado.
    const parcelas: Record<keyof CustosObra, Prisma.Decimal> = {
      motorista: dec(lucro.custos.motorista),
      pedagio: pedagioViagemTotal,
      combustivel: dec(lucro.custos.combustivel),
      pedagioAvulso: dec(lucro.custos.pedagio).sub(pedagioViagemTotal),
      manutencao: dec(lucro.custos.manutencao),
      multas: dec(lucro.custos.multas),
      custosFixos: dec(lucro.custos.custosFixos),
      outrasContas: dec(lucro.custos.outrasContas),
    };

    if (vs.length === 0) {
      const total = somaCustos(parcelas);
      if (total.isZero()) continue;
      for (const k of CHAVES_CUSTO) paradoCustos[k] = paradoCustos[k].add(parcelas[k]);
      parados.push({ veiculoId: c.veiculoId, placa: c.placa, custo: total.toFixed(2) });
      continue;
    }

    const pesoKm = vs.map((v) => v.km);
    const partes: Record<keyof CustosObra, Prisma.Decimal[]> = {
      motorista: ratearCentavos(parcelas.motorista, motoristas.map((m) => m.valor)),
      pedagio: ratearCentavos(parcelas.pedagio, pedagiosViagem),
      combustivel: ratearCentavos(parcelas.combustivel, pesoKm),
      pedagioAvulso: ratearCentavos(parcelas.pedagioAvulso, pesoKm),
      manutencao: ratearCentavos(parcelas.manutencao, pesoKm),
      multas: ratearCentavos(parcelas.multas, pesoKm),
      custosFixos: ratearCentavos(parcelas.custosFixos, pesoKm),
      outrasContas: ratearCentavos(parcelas.outrasContas, pesoKm),
    };

    vs.forEach((v, i) => {
      const a = acumDe(v.obra);
      const semPreco = v.valorTotal == null;
      const total = semPreco ? ZERO() : dec(v.valorTotal);
      // Frete = total − pedágio repassado: assim frete + pedágio fecha com o
      // `valorTotal` que o lucro soma, mesmo que alguém tenha mexido à mão.
      const pedCobrado = semPreco ? ZERO() : dec(v.pedagioCobrado);
      const estadia = dec(v.estadia);

      let custoDireto = ZERO();
      let custo = ZERO();
      for (const k of CHAVES_CUSTO) {
        const p = partes[k][i]!;
        a.custos[k] = a.custos[k].add(p);
        custo = custo.add(p);
        if (DIRETOS.includes(k)) custoDireto = custoDireto.add(p);
      }

      a.viagens++;
      a.toneladas = a.toneladas.add(dec(v.toneladas));
      a.km = a.km.add(dec(v.km));
      a.frete = a.frete.add(total.sub(pedCobrado));
      a.pedagioCobrado = a.pedagioCobrado.add(pedCobrado);
      a.estadia = a.estadia.add(estadia);
      if (semPreco) {
        a.avisos.viagensSemPreco++;
        a.semPreco.viagens++;
        a.semPreco.toneladas = a.semPreco.toneladas.add(dec(v.toneladas));
        a.semPreco.custo = a.semPreco.custo.add(custo);
      }
      const m = motoristas[i]!;
      if (m.situacao === "EMPREGADO") a.avisos.viagensEmpregado++;
      else if (m.situacao === "SEM_REGUA") a.avisos.viagensSemCustoMotorista++;

      const receita = total.add(estadia);
      a.lista.push({
        id: v.id,
        data: v.data.toISOString().slice(0, 10),
        ticket: v.ticket,
        placa: c.placa,
        toneladas: dec(v.toneladas).toFixed(3),
        km: dec(v.km).toFixed(0),
        semPreco,
        receita: receita.toFixed(2),
        custoDireto: custoDireto.toFixed(2),
        custoRateado: custo.sub(custoDireto).toFixed(2),
        custo: custo.toFixed(2),
        margem: receita.sub(custo).toFixed(2),
      });
    });
  }

  const todas = [...porObra.values()].map(fecharLinha);
  const semObraTodas = todas.find((l) => l.chave === OBRA_SEM_OBRA) ?? null;
  let obras = todas.filter((l) => l.chave !== OBRA_SEM_OBRA);
  if (empresaId) obras = obras.filter((l) => l.empresaId === empresaId);
  obras.sort((x, y) => Number(x.margem) - Number(y.margem) || x.obra.localeCompare(y.obra));

  const filtrado = !!empresaId;
  const semObra = filtrado ? null : semObraTodas;
  const paradoTotal = somaCustos(paradoCustos);
  const parado =
    filtrado || paradoTotal.isZero()
      ? null
      : {
          custo: paradoTotal.toFixed(2),
          custos: custosTexto(paradoCustos),
          caminhoes: parados.sort((x, y) => Number(y.custo) - Number(x.custo)),
        };

  return {
    obras,
    semObra,
    parado,
    total: totalizar([...obras, ...(semObra ? [semObra] : [])], parado?.custos ?? null, obras.length),
    conferencia: filtrado
      ? null
      : { faturouLucro: faturouLucro.toFixed(2), gastouLucro: gastouLucro.toFixed(2) },
  };
}

function totalizar(
  linhas: LinhaResultadoObraDetalhe[],
  parado: CustosObra | null,
  nObras: number,
): RelatorioResultadoObraResposta["total"] {
  const soma = (f: (l: LinhaResultadoObraDetalhe) => string) =>
    linhas.reduce((a, l) => a.add(f(l)), ZERO());
  const custos = custosZerados();
  for (const k of CHAVES_CUSTO) {
    custos[k] = soma((l) => l.custos[k]).add(parado ? parado[k] : 0);
  }
  const receita = {
    frete: soma((l) => l.receita.frete),
    pedagio: soma((l) => l.receita.pedagio),
    estadia: soma((l) => l.receita.estadia),
  };
  const receitaTotal = receita.frete.add(receita.pedagio).add(receita.estadia);
  const custo = somaCustos(custos);
  const margem = receitaTotal.sub(custo);
  return {
    obras: nObras,
    viagens: linhas.reduce((s, l) => s + l.viagens, 0),
    toneladas: soma((l) => l.toneladas).toFixed(3),
    km: soma((l) => l.km).toFixed(0),
    receita: {
      frete: receita.frete.toFixed(2),
      pedagio: receita.pedagio.toFixed(2),
      estadia: receita.estadia.toFixed(2),
      total: receitaTotal.toFixed(2),
    },
    custos: custosTexto(custos),
    custo: custo.toFixed(2),
    margem: margem.toFixed(2),
    margemPct: margemPct(margem, receitaTotal),
    semPreco: {
      viagens: linhas.reduce((s, l) => s + l.semPreco.viagens, 0),
      toneladas: soma((l) => l.semPreco.toneladas).toFixed(3),
      custo: soma((l) => l.semPreco.custo).toFixed(2),
    },
    avisos: {
      viagensSemPreco: linhas.reduce((s, l) => s + l.avisos.viagensSemPreco, 0),
      viagensSemCustoMotorista: linhas.reduce((s, l) => s + l.avisos.viagensSemCustoMotorista, 0),
      viagensEmpregado: linhas.reduce((s, l) => s + l.avisos.viagensEmpregado, 0),
    },
  };
}
