import { Prisma, StatusViagem, type BasePreco } from "@prisma/client";
import { aplicarMinimos, type MinimoOverride, type ViagemBruta } from "./viagem-minimos";
import { STATUS_FORA_FECHAMENTO } from "./viagem-status";

/**
 * Quanto a viagem VALE.
 *
 * A separação que organiza tudo aqui: a `RegraMinimo` decide QUANTO SE CONTA
 * (km/toneladas efetivos), esta regra decide QUANTO VALE o que foi contado. As
 * duas nunca se misturam, e a ordem é sempre mínimo primeiro, preço depois —
 * multiplicar o real quando existe mínimo é subfaturar em silêncio.
 *
 * A resolução de "qual linha da tabela casa" é DELIBERADAMENTE idêntica à de
 * `viagem-minimos.ts`: mesma faixa (de inclusivo, até exclusivo, null = sem
 * teto), mesmo desempate (material específico vence "qualquer"; entre iguais, a
 * faixa mais estreita). Se as duas divergirem, o mínimo vai valer pra uma faixa
 * e o preço pra outra, e ninguém vai entender a fatura.
 */

type DecimalLike = Prisma.Decimal | string | number;

function dec(v: DecimalLike): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);
}

export type TabelaPrecoRow = {
  id: string;
  empresaId: string;
  materialId: string | null;
  tipoServicoId: string | null;
  kmFaixaDe: DecimalLike;
  kmFaixaAte: DecimalLike | null;
  base: BasePreco;
  precoUnitario: DecimalLike;
  repassaPedagio: boolean;
  vigenciaDe: Date;
  vigenciaAte: Date | null;
  ativo?: boolean;
};

/** O que o cálculo precisa saber da viagem, além do que `aplicarMinimos` já pede. */
export type ViagemParaPreco = ViagemBruta & {
  status?: StatusViagem | null;
  data?: Date | string | null;
  valorPedagioTotal?: DecimalLike | null;
  tipoServicoId?: string | null;
};

export type ValorCalculado = {
  tabelaPrecoId: string;
  base: BasePreco;
  precoUnitario: string;
  quantidade: string;
  valorFrete: string;
  valorPedagio: string;
  valorTotal: string;
};

/** Por que uma viagem ficou sem valor. Some na tela como explicação, não como erro. */
export type SemPrecoMotivo =
  | "VIAGEM_INCOMPLETA"
  | "SEM_EMPRESA"
  | "SEM_TABELA"
  | "BASE_INCOMPATIVEL";

/**
 * Só a data importa pra vigência, nunca a hora. O container roda em UTC e a
 * viagem tem `data` como DATE — comparar timestamps faria a viagem do dia 1º
 * cair na vigência que terminou dia 31 dependendo do fuso.
 */
function soData(d: Date | string): number {
  const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  return Date.parse(`${s}T00:00:00Z`);
}

function vigenteEm(linha: TabelaPrecoRow, dataViagem: Date | string): boolean {
  const d = soData(dataViagem);
  if (soData(linha.vigenciaDe) > d) return false;
  // `vigenciaAte` é INCLUSIVO — ao contrário de `kmFaixaAte`. Dia de fim de
  // contrato é um dia que ainda vale; faixa de km é medida contínua e não tem
  // "último km". Parece inconsistente e não é: são grandezas diferentes.
  if (linha.vigenciaAte != null && soData(linha.vigenciaAte) < d) return false;
  return true;
}

/**
 * Acha a linha de preço que casa. `null` se nada casar — o que é normal e não é
 * erro: empresa sem tabela cadastrada simplesmente não tem valor calculado.
 */
export function tabelaPrecoAplicada(
  tabelas: TabelaPrecoRow[],
  args: {
    empresaId: string;
    materialId: string | null;
    tipoServicoId: string | null;
    kmReal: DecimalLike;
    data: Date | string;
  },
): TabelaPrecoRow | null {
  const km = dec(args.kmReal);
  const candidatas = tabelas.filter(
    (t) =>
      t.ativo !== false &&
      t.empresaId === args.empresaId &&
      (t.materialId == null || t.materialId === args.materialId) &&
      (t.tipoServicoId == null || t.tipoServicoId === args.tipoServicoId) &&
      dec(t.kmFaixaDe).lte(km) &&
      (t.kmFaixaAte == null || km.lt(dec(t.kmFaixaAte))) &&
      vigenteEm(t, args.data),
  );
  if (candidatas.length === 0) return null;

  candidatas.sort((a, b) => {
    // Modo de serviço específico é o desempate mais forte: uma linha de diária
    // não pode perder pra uma linha genérica de frete só porque a genérica tem
    // faixa mais estreita — seria cobrar diária por tonelada.
    const servA = a.tipoServicoId ? 1 : 0;
    const servB = b.tipoServicoId ? 1 : 0;
    if (servA !== servB) return servB - servA;

    const matA = a.materialId ? 1 : 0;
    const matB = b.materialId ? 1 : 0;
    if (matA !== matB) return matB - matA;

    const faixa = Number(b.kmFaixaDe) - Number(a.kmFaixaDe);
    if (faixa !== 0) return faixa;

    // Empate real: vale a vigência que começou por último. É o reajuste mais
    // recente — cadastrar o preço novo sem fechar o antigo é o erro de digitação
    // mais provável do mundo, e ele tem que resultar no preço NOVO.
    return soData(b.vigenciaDe) - soData(a.vigenciaDe);
  });
  return candidatas[0]!;
}

/**
 * Calcula o valor da viagem. Devolve `{ valor }` ou `{ motivo }` dizendo por que
 * não deu — a tela precisa distinguir "essa empresa não tem tabela" de "essa
 * viagem ainda não pode valer nada".
 */
export function calcularValorViagem(
  viagem: ViagemParaPreco,
  args: {
    empresaId: string | null | undefined;
    materialId: string | null;
    tabelas: TabelaPrecoRow[];
    minimo?: MinimoOverride;
  },
): { valor: ValorCalculado; motivo?: never } | { valor?: never; motivo: SemPrecoMotivo } {
  // Viagem incompleta não vale dinheiro. É a mesma trava do fechamento: uma
  // viagem sem peso valeria zero tonelada vezes o preço, e zero na fatura é
  // pior que ausência — parece conferido.
  if (viagem.status != null && STATUS_FORA_FECHAMENTO.includes(viagem.status)) {
    return { motivo: "VIAGEM_INCOMPLETA" };
  }
  if (!args.empresaId) return { motivo: "SEM_EMPRESA" };

  const linha = tabelaPrecoAplicada(args.tabelas, {
    empresaId: args.empresaId,
    materialId: args.materialId,
    tipoServicoId: viagem.tipoServicoId ?? null,
    kmReal: viagem.km ?? 0,
    data: viagem.data ?? new Date(),
  });
  if (!linha) return { motivo: "SEM_TABELA" };

  const ehPeriodo = viagem.tipoServico?.medicao === "PERIODO";
  // Diária cobrada por tonelada é dinheiro inventado — o caminhão pode não ter
  // saído do pátio. `aplicarMinimos` já blinda o mínimo por período pelo mesmo
  // motivo; aqui a blindagem é do preço.
  if (ehPeriodo && linha.base !== "PERIODO" && linha.base !== "VIAGEM") {
    return { motivo: "BASE_INCOMPATIVEL" };
  }
  if (!ehPeriodo && linha.base === "PERIODO") {
    return { motivo: "BASE_INCOMPATIVEL" };
  }

  // O preço multiplica o EFETIVO, nunca o real.
  const efetivo = aplicarMinimos(viagem, args.minimo);

  let quantidade: Prisma.Decimal;
  switch (linha.base) {
    case "TONELADA":
      quantidade = dec(efetivo.toneladasEfetiva);
      break;
    case "KM":
      quantidade = dec(efetivo.kmEfetivo);
      break;
    // VIAGEM e PERIODO são valor fechado: a quantidade é 1 e fica gravada assim
    // pra conta ser reconstituível sem um `if` em cada lugar que lê.
    default:
      quantidade = new Prisma.Decimal(1);
  }

  const preco = dec(linha.precoUnitario);
  const valorFrete = quantidade.mul(preco);
  const valorPedagio = linha.repassaPedagio ? dec(viagem.valorPedagioTotal ?? 0) : new Prisma.Decimal(0);

  return {
    valor: {
      tabelaPrecoId: linha.id,
      base: linha.base,
      precoUnitario: preco.toFixed(2),
      quantidade: quantidade.toFixed(3),
      valorFrete: valorFrete.toFixed(2),
      valorPedagio: valorPedagio.toFixed(2),
      valorTotal: valorFrete.add(valorPedagio).toFixed(2),
    },
  };
}

/** Texto pro painel explicar por que a viagem está sem valor. */
export const SEM_PRECO_TEXTO: Record<SemPrecoMotivo, string> = {
  VIAGEM_INCOMPLETA: "Viagem ainda incompleta — só ganha valor quando fechar.",
  SEM_EMPRESA: "Viagem sem empresa tomadora, então não há de quem cobrar.",
  SEM_TABELA: "Nenhum preço cadastrado que sirva pra esta viagem.",
  BASE_INCOMPATIVEL: "O preço cadastrado é de outra unidade (diária x frete).",
};
