import { Prisma } from "@prisma/client";

/**
 * A conta que o autônomo faz no papel antes de aceitar a carga.
 *
 * Ele não precisa saber "quanto é o frete". Ele precisa saber o que SOBRA
 * depois do diesel, do pedágio e do que o caminhão custa por km rodado —
 * porque frete de R$ 4.000 que deixa R$ 200 é pior que um de R$ 2.500 que
 * deixa R$ 900, e nenhuma tela dizia isso.
 *
 * Todo número aqui sai do histórico DELE. Nada de média de mercado: o cara
 * decide com isso, e um número plausível e errado é pior que nenhum.
 */

/** Quanto o caminhão custa por km rodado, fora o diesel do trecho. */
export type CustoPorKm = {
  /** null = não dá pra saber ainda (sem km lançado no período). */
  valor: number | null;
  /** Quanto ele gastou no período, fora combustível. */
  gastos: number;
  km: number;
  dias: number;
};

/**
 * Custo por km DELE: tudo que saiu no período ÷ km rodado no período.
 *
 * O combustível fica de fora **de propósito**: o diesel do trecho é estimado
 * à parte, pelo consumo medido, e somar os dois contaria diesel duas vezes —
 * o erro que transforma um frete bom em recusado.
 *
 * Manutenção, pneu, alimentação e o resto entram: são o custo de rodar, e não
 * de rodar ESTE trecho.
 */
export function custoPorKmDele(args: {
  gastosNaoCombustivel: number;
  kmRodado: number;
  dias: number;
}): CustoPorKm {
  const { gastosNaoCombustivel: gastos, kmRodado: km, dias } = args;
  return {
    // Zero km com gasto é divisão por zero, não custo infinito: devolve null e
    // a tela pede o dado em vez de mostrar "R$ ∞/km".
    valor: km > 0 ? Math.round((gastos / km) * 100) / 100 : null,
    gastos,
    km,
    dias,
  };
}

export type PracaComTarifa = {
  nome: string;
  /** Tarifa do eixo simples. Null = praça conhecida, preço não cadastrado. */
  valorBase: Prisma.Decimal | string | number | null;
};

export type PedagioDaRota = {
  /** Soma em R$. Null quando não dá pra afirmar nada (sem eixos). */
  total: number | null;
  /** Quantas praças entraram na soma. */
  comTarifa: number;
  /** Praças na rota sem preço cadastrado — a soma é um PISO, não o total. */
  semTarifa: number;
  /** Por que o total é null. */
  motivo?: "SEM_EIXOS" | "SEM_TARIFA";
};

/**
 * Pedágio da rota em R$.
 *
 * A tarifa cadastrada é a do eixo simples; caminhão de N eixos paga N vezes.
 *
 * Praça sem preço cadastrado NÃO é tratada como zero — ela é contada à parte,
 * e a tela diz que o valor é um piso. Somar zero por uma praça desconhecida
 * daria um total menor que o real, que é o erro que faz o frete parecer
 * melhor do que é.
 */
export function pedagioDaRota(pracas: PracaComTarifa[], eixos: number | null): PedagioDaRota {
  const semTarifa = pracas.filter((p) => p.valorBase == null).length;
  const comTarifa = pracas.length - semTarifa;

  if (eixos == null || eixos <= 0) {
    return { total: null, comTarifa, semTarifa, motivo: "SEM_EIXOS" };
  }
  if (comTarifa === 0) {
    return { total: null, comTarifa, semTarifa, motivo: pracas.length > 0 ? "SEM_TARIFA" : undefined };
  }

  let total = new Prisma.Decimal(0);
  for (const p of pracas) {
    if (p.valorBase == null) continue;
    const base =
      p.valorBase instanceof Prisma.Decimal ? p.valorBase : new Prisma.Decimal(p.valorBase);
    total = total.add(base.mul(eixos));
  }
  return { total: Number(total.toFixed(2)), comTarifa, semTarifa };
}

export type ResultadoDoFrete = {
  /** O que ele leva pra casa: frete − diesel − pedágio − custo do trecho. */
  sobra: number | null;
  /** Sobra por km. É o número que compara frete curto com frete longo. */
  sobraPorKm: number | null;
  /** Quais custos entraram. O que é null não entrou, e a tela precisa dizer. */
  diesel: number | null;
  pedagio: number | null;
  custoDoTrecho: number | null;
  /** `true` quando algum custo ficou de fora — a sobra é otimista. */
  incompleto: boolean;
};

/**
 * O que sobra do frete.
 *
 * Custo que não deu pra calcular entra como ZERO na conta e levanta a bandeira
 * `incompleto`. É deliberado: descartar a conta inteira porque falta uma praça
 * de pedágio devolveria a tela em branco justo pra quem está começando, e a
 * sobra com aviso ainda é informação — desde que a tela diga que é otimista.
 */
export function resultadoDoFrete(args: {
  valorFrete: number;
  km: number;
  diesel: number | null;
  pedagio: number | null;
  custoPorKm: number | null;
}): ResultadoDoFrete {
  const custoDoTrecho =
    args.custoPorKm != null && args.km > 0
      ? Math.round(args.custoPorKm * args.km * 100) / 100
      : null;

  const incompleto = args.diesel == null || args.pedagio == null || custoDoTrecho == null;
  const sobra =
    Math.round(
      (args.valorFrete - (args.diesel ?? 0) - (args.pedagio ?? 0) - (custoDoTrecho ?? 0)) * 100,
    ) / 100;

  return {
    sobra,
    sobraPorKm: args.km > 0 ? Math.round((sobra / args.km) * 100) / 100 : null,
    diesel: args.diesel,
    pedagio: args.pedagio,
    custoDoTrecho,
    incompleto,
  };
}

export type FreteAnterior = {
  origem: string;
  destino: string;
  data: Date;
  km: number | null;
  valorRecebido: number | null;
};

export type Comparacao = {
  /** Quantos fretes iguais ele já fez. */
  vezes: number;
  /** A mediana do que ele recebeu — mais honesta que a média num histórico curto. */
  medianaValor: number | null;
  medianaPorKm: number | null;
  ultimaVez: Date | null;
};

/**
 * Normaliza pra comparar "Ponta Grossa/PR" com "ponta grossa - pr".
 *
 * A UF no fim é descartada: ele escreve o mesmo lugar de três jeitos ao longo
 * do ano ("Ponta Grossa", "Ponta Grossa-PR", "ponta grossa / pr") e tratar isso
 * como três trechos diferentes faria o histórico dele nunca encontrar nada —
 * que é o mesmo que não ter histórico.
 */
const UFS =
  "ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to".split(" ");

export function chaveTrecho(origem: string, destino: string): string {
  const limpar = (s: string) => {
    const base = s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const partes = base.split(" ");
    // Só remove a sigla do FIM, e só se sobrar nome: "SP" sozinho é o que a
    // pessoa escreveu, e virar string vazia casaria com qualquer outro vazio.
    if (partes.length > 1 && UFS.includes(partes[partes.length - 1]!)) partes.pop();
    return partes.join(" ");
  };
  return `${limpar(origem)}>${limpar(destino)}`;
}

/**
 * "Esse trecho você já fez" — por quanto.
 *
 * É a única referência de preço honesta que o sistema tem pra dar a ele: o
 * que ELE já recebeu. Tabela de mercado o app não conhece, e inventar uma
 * seria colocar um número na boca dele numa negociação.
 */
export function compararComHistorico(
  origem: string,
  destino: string,
  anteriores: FreteAnterior[],
): Comparacao {
  const alvo = chaveTrecho(origem, destino);
  const iguais = anteriores.filter(
    (f) => chaveTrecho(f.origem, f.destino) === alvo && f.valorRecebido != null,
  );
  if (iguais.length === 0) {
    return { vezes: 0, medianaValor: null, medianaPorKm: null, ultimaVez: null };
  }

  const valores = iguais.map((f) => f.valorRecebido!).sort((a, b) => a - b);
  const porKm = iguais
    .filter((f) => f.km != null && f.km > 0)
    .map((f) => f.valorRecebido! / f.km!)
    .sort((a, b) => a - b);

  return {
    vezes: iguais.length,
    medianaValor: mediana(valores),
    medianaPorKm: porKm.length > 0 ? Math.round(mediana(porKm)! * 100) / 100 : null,
    ultimaVez: iguais.reduce<Date | null>(
      (m, f) => (m == null || f.data > m ? f.data : m),
      null,
    ),
  };
}

/** Uma viagem dele que já teve pedágio anotado. */
export type PedagioAnterior = {
  origem: string;
  destino: string;
  data: Date;
  /** Soma dos lançamentos de PEDAGIO amarrados àquela viagem. */
  pedagio: number;
};

export type PedagioDoHistorico = {
  vezes: number;
  /** Mediana do que ele pagou. Mediana, não média: um trecho com desvio por
   *  obra vira outlier e a média inteira mente. */
  mediana: number | null;
  ultimaVez: Date | null;
};

/**
 * Quanto ELE pagou de pedágio nesse mesmo trecho.
 *
 * É o plano B do `pedagioDaRota`, e existe porque a tarifa das praças não é
 * um dado que se compre uma vez: são dezenas de concessões, cada uma
 * publicando a sua tabela, reajustada todo ano na data do contrato. Um
 * raspador disso envelhece em silêncio, e tarifa velha num app que responde
 * "sobra quanto" é pior que tarifa nenhuma.
 *
 * O número dele não tem esse problema: já inclui o desconto do Sem Parar, o
 * eixo suspenso que ele levanta vazio e o caminho que ele de fato faz. É a
 * mesma escolha que o diesel já fazia ao medir o consumo DELE em vez de usar
 * média de mercado.
 */
export type ViagemParaPedagio = { id: string; origem: string; destino: string; data: Date };
export type GastoDePedagio = { viagemPessoalId: string | null; data: Date; valor: number };

/** Dia civil como chave. `data` é `@db.Date`, gravado à meia-noite UTC. */
const diaDe = (d: Date) => d.toISOString().slice(0, 10);

/**
 * De quem é cada pedágio lançado.
 *
 * O vínculo explícito (`viagemPessoalId`) é o certo e sempre vence — mas hoje
 * NADA o preenche: a coluna existe no Prisma e não aparece no app nem no schema
 * Zod. Exigir só ele seria escrever um plano B que nunca dispara.
 *
 * Então cai pra inferência, com uma trava: o gasto só é atribuído quando existe
 * EXATAMENTE UMA viagem naquele dia. Com duas, não há como saber de qual delas
 * foi o pedágio, e chutar contaminaria a mediana de um trecho com o custo de
 * outro — o tipo de erro que ninguém percebe e que faz o motorista recusar
 * frete bom por causa de número errado.
 */
export function pedagioPorViagem(
  viagens: ViagemParaPedagio[],
  gastos: GastoDePedagio[],
): PedagioAnterior[] {
  const porId = new Map(viagens.map((v) => [v.id, v]));

  const porDia = new Map<string, ViagemParaPedagio[]>();
  for (const v of viagens) {
    const dia = diaDe(v.data);
    porDia.set(dia, [...(porDia.get(dia) ?? []), v]);
  }

  const soma = new Map<string, number>();
  for (const g of gastos) {
    let alvo = g.viagemPessoalId ? porId.get(g.viagemPessoalId) : undefined;
    if (!alvo) {
      const doDia = porDia.get(diaDe(g.data)) ?? [];
      if (doDia.length !== 1) continue; // ambíguo (ou nenhuma): não inventa
      alvo = doDia[0]!;
    }
    soma.set(alvo.id, (soma.get(alvo.id) ?? 0) + g.valor);
  }

  return [...soma.entries()].map(([id, pedagio]) => {
    const v = porId.get(id)!;
    return { origem: v.origem, destino: v.destino, data: v.data, pedagio };
  });
}

export function pedagioDoHistorico(
  origem: string,
  destino: string,
  anteriores: PedagioAnterior[],
): PedagioDoHistorico {
  const alvo = chaveTrecho(origem, destino);
  const iguais = anteriores.filter(
    (v) => chaveTrecho(v.origem, v.destino) === alvo && v.pedagio > 0,
  );
  if (iguais.length === 0) return { vezes: 0, mediana: null, ultimaVez: null };

  return {
    vezes: iguais.length,
    mediana: mediana(iguais.map((v) => v.pedagio).sort((a, b) => a - b)),
    ultimaVez: iguais.reduce<Date | null>((m, v) => (m == null || v.data > m ? v.data : m), null),
  };
}

function mediana(ord: number[]): number | null {
  if (ord.length === 0) return null;
  const meio = Math.floor(ord.length / 2);
  const v = ord.length % 2 === 0 ? (ord[meio - 1]! + ord[meio]!) / 2 : ord[meio]!;
  return Math.round(v * 100) / 100;
}
