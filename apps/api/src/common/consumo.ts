/**
 * Consumo médio (km/l) pelo método tanque-a-tanque.
 *
 * Os dois campos que tornam esta conta possível — `odometro` e `tanqueCheio` —
 * já eram gravados em TODO abastecimento e nunca lidos por nada. Diesel é o
 * maior custo variável da operação, e o dado estava pago e indo pro lixo.
 *
 * O MÉTODO, que é o que separa um número confiável de um chute:
 *
 * Só se mede entre dois abastecimentos de tanque CHEIO. A razão é simples: num
 * tanque cheio, o que coube no bocal é exatamente o que foi queimado desde o
 * cheio anterior — o nível de partida e o de chegada são o mesmo, então a
 * incerteza some. Um abastecimento parcial não diz quanto ainda havia no tanque.
 *
 * Parciais no meio não são descartados: os litros deles entram na conta do
 * intervalo (foram queimados ali), o que não entra é a fronteira. Ignorá-los
 * daria um km/l otimista — km demais para litros de menos.
 *
 * Os litros do cheio de ABERTURA ficam de fora e os do cheio de FECHAMENTO
 * entram: o que enche o tanque no fim é o que repõe o que o trecho gastou.
 */

export type AbastecimentoParaConsumo = {
  id: string;
  data: Date;
  odometro: number | null;
  litros: number;
  tanqueCheio: boolean;
  /** Comboio = abastecido por caminhão-tanque, sem bomba nem cupom. */
  emComboio?: boolean;
  /**
   * Quando a linha foi gravada. Serve de desempate, e só isso.
   *
   * Opcional porque só um dos dois lados precisa. No abastecimento da FROTA,
   * `data` é timestamp completo e a hora já desempata. No lançamento pessoal
   * ela é `@db.Date` — dia civil, sem hora — e dois cheios no mesmo dia, que
   * acontece em viagem longa ou quando ele completa em dois postos, empatavam:
   * a ordem vinha do banco, que não promete nenhuma.
   */
  criadoEm?: Date;
};

export type TrechoConsumo = {
  deId: string;
  ateId: string;
  de: Date;
  ate: Date;
  km: number;
  litros: number;
  kmPorLitro: number;
};

export type ConsumoVeiculo = {
  /** null quando não houve dois cheios com odômetro pra comparar. */
  kmPorLitro: number | null;
  kmTotal: number;
  litrosTotal: number;
  /** Quantos intervalos entraram na conta. Um só já vale, mas vale menos. */
  trechos: TrechoConsumo[];
  /** Por que não deu pra calcular — some na tela como explicação. */
  motivo?: "SEM_DOIS_CHEIOS" | "SEM_ODOMETRO" | "ODOMETRO_INCONSISTENTE";
};

/**
 * Odômetro que anda pra trás, ou que dá um salto absurdo, é erro de digitação
 * (ou troca de painel). Um trecho assim envenena a média inteira, então ele sai
 * da conta em vez de virar um km/l de 0,3 que ninguém entende.
 *
 * 5.000 km entre dois abastecimentos é o teto: um caminhão faz uns 400-600 km
 * com um tanque, e mesmo um bitanque não chega perto disso.
 */
const KM_MAXIMO_ENTRE_CHEIOS = 5000;

export function calcularConsumo(abastecimentos: AbastecimentoParaConsumo[]): ConsumoVeiculo {
  const vazio: ConsumoVeiculo = { kmPorLitro: null, kmTotal: 0, litrosTotal: 0, trechos: [] };

  // Ordem cronológica é premissa do método: o intervalo é entre um cheio e o
  // próximo. Ordenamos aqui pra não depender de quem chamou ter feito certo.
  //
  // O desempate não é preciosismo. `data` é dia civil, sem hora, então dois
  // cheios no mesmo dia empatavam e a ordem saía do banco — que não promete
  // nenhuma. Invertido, o km dava negativo e o motorista era informado de que
  // o odômetro DELE estava trocado, por um erro que era nosso.
  //
  // `criadoEm` primeiro porque é a ordem real de entrada. O odômetro só decide
  // quando não há `criadoEm` nos dois: ele é monotônico por física, mas usá-lo
  // antes esconderia um erro de digitação em vez de denunciá-lo.
  const ordenados = [...abastecimentos].sort(
    (a, b) =>
      a.data.getTime() - b.data.getTime() ||
      (a.criadoEm && b.criadoEm ? a.criadoEm.getTime() - b.criadoEm.getTime() : 0) ||
      (a.odometro ?? 0) - (b.odometro ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  // Posição na lista ordenada: é ela que define "entre um cheio e o outro".
  const posicao = new Map(ordenados.map((a, i) => [a.id, i]));

  const cheios = ordenados.filter((a) => a.tanqueCheio && a.odometro != null);
  if (cheios.length < 2) {
    const temCheios = ordenados.filter((a) => a.tanqueCheio).length >= 2;
    return { ...vazio, motivo: temCheios ? "SEM_ODOMETRO" : "SEM_DOIS_CHEIOS" };
  }

  const trechos: TrechoConsumo[] = [];
  let descartados = 0;

  for (let i = 1; i < cheios.length; i++) {
    const inicio = cheios[i - 1]!;
    const fim = cheios[i]!;
    const km = (fim.odometro as number) - (inicio.odometro as number);
    if (km <= 0 || km > KM_MAXIMO_ENTRE_CHEIOS) {
      descartados++;
      continue;
    }

    // Tudo que foi abastecido DEPOIS do cheio de abertura até o de fechamento,
    // inclusive — parciais no meio entram.
    //
    // Por POSIÇÃO, não por data: com `a.data > inicio.data` dois cheios do
    // mesmo dia somavam zero litro (nenhuma data é maior que ela mesma), o
    // trecho caía como inconsistente e o km/l nunca saía — mesmo com a ordem
    // certa e o odômetro perfeito.
    const litros = ordenados
      .slice(posicao.get(inicio.id)! + 1, posicao.get(fim.id)! + 1)
      .reduce((s, a) => s + a.litros, 0);
    if (litros <= 0) {
      descartados++;
      continue;
    }

    trechos.push({
      deId: inicio.id,
      ateId: fim.id,
      de: inicio.data,
      ate: fim.data,
      km,
      litros,
      kmPorLitro: Number((km / litros).toFixed(2)),
    });
  }

  if (trechos.length === 0) {
    return { ...vazio, motivo: descartados > 0 ? "ODOMETRO_INCONSISTENTE" : "SEM_DOIS_CHEIOS" };
  }

  const kmTotal = trechos.reduce((s, t) => s + t.km, 0);
  const litrosTotal = trechos.reduce((s, t) => s + t.litros, 0);
  return {
    // Média ponderada pelo km, não média das médias: um trecho de 500 km pesa
    // mais que um de 50, e é assim que o motorista faz a conta de cabeça.
    kmPorLitro: Number((kmTotal / litrosTotal).toFixed(2)),
    kmTotal,
    litrosTotal: Number(litrosTotal.toFixed(2)),
    trechos,
  };
}

export const CONSUMO_MOTIVO_TEXTO: Record<NonNullable<ConsumoVeiculo["motivo"]>, string> = {
  SEM_DOIS_CHEIOS: "Precisa de pelo menos dois abastecimentos de tanque cheio no período.",
  SEM_ODOMETRO: "Os abastecimentos de tanque cheio não têm o odômetro anotado.",
  ODOMETRO_INCONSISTENTE: "O odômetro anotado não bate (voltou ou deu um salto grande demais).",
};
