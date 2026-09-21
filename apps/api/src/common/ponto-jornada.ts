/**
 * A APURAÇÃO DA JORNADA. Regra pura: nada de Prisma, nada de HTTP.
 *
 * É onde mora a conta que vai pra folha de pagamento de gente registrada, e
 * por isso cada decisão aqui tem um porquê escrito. Errar aqui não dá erro em
 * lugar nenhum — dá um número plausível e errado, que só aparece na
 * liquidação de sentença, anos depois.
 *
 * ⚠️ A REGRA FUNDADORA: o registro original só tem INSTANTE e PESSOA. Não tem
 * "entrada", não tem "saída", não tem "almoço". Tudo isso é decidido AQUI, na
 * leitura, por ordem cronológica. É o que permite obedecer o art. 82, IV da
 * Portaria 671 (não alterar o dado registrado pelo trabalhador): quem errou o
 * botão não tem botão pra errar.
 */

/** "2026-09-20". Nunca Date solto — Date solto vira bug de fuso. */
export type Ymd = string;

export type MarcacaoApurada = {
  /** O identificador da marcação (o "número de registro" do comprovante). */
  numero: number;
  marcadoEm: Date;
  /** Desconsiderada por correção aprovada. Continua no espelho, riscada. */
  desconsiderada: boolean;
  /**
   * Veio de uma CORREÇÃO aprovada, não do dedo do trabalhador.
   *
   * ⚠️ Tem que viajar até a tela. Um horário incluído por ajuste aparecendo
   * igual a um que a pessoa bateu apaga a única distinção que importa num
   * documento de jornada: o que ela registrou e o que fizeram por ela.
   */
  incluida?: boolean;
};

export type Par = {
  entrada: Date;
  saida: Date | null;
  /** Bateu e não fechou. NUNCA inventa a saída. */
  emAberto: boolean;
  minutos: number;
  /** O dia a que este par pertence: o da ABERTURA. Ver `apurarPeriodo`. */
  dia: Ymd;
  numeros: number[];
  /** A abertura veio de correção aprovada, não do dedo dele. */
  entradaIncluida: boolean;
  /** Idem pro fechamento. Um par pode ter um lado de cada. */
  saidaIncluida: boolean;
};

export type Tolerancia = { porMarcacaoMin: number; diariaMin: number };

export type JornadaDiaPura = {
  trabalha: boolean;
  /** "07:00" — sem isto não existe previsto, e sem previsto não existe saldo. */
  entrada: string | null;
  saida: string | null;
  intervaloMin: number;
  cargaMin: number;
  nomeModelo: string;
  tolerancia: Tolerancia;
  intervaloMinimoMin: number;
  preAssinalacaoMinutos: number | null;
};

export type AlertaPonto =
  /** Número ímpar de marcações: alguém não fechou o par. */
  | { codigo: "CONFERIR"; numeros: number[] }
  | { codigo: "SEM_INTERVALO"; minimoMin: number }
  /** Dia previsto, zero marcação. */
  | { codigo: "SEM_REGISTRO" }
  /** Marcou em dia sem previsão de trabalho. Não é erro — é informação. */
  | { codigo: "FORA_DA_JORNADA" }
  | { codigo: "RELOGIO_DIVERGENTE"; segundos: number }
  | { codigo: "DIRECAO_CONTINUA"; minutos: number }
  | { codigo: "INTERJORNADA_CURTA"; minutos: number }
  | { codigo: "DESCANSO_SEMANAL_CURTO"; minutos: number };

export type ApuracaoDia = {
  dia: Ymd;
  /** O dia ainda não aconteceu. Não é dívida, e não entra no saldo. */
  futuro: boolean;
  pares: Par[];
  minutosTrabalhados: number;
  minutosConsiderados: number;
  minutosPrevistos: number;
  saldoMin: number;
  nomeModelo: string;
  alertas: AlertaPonto[];
};

/**
 * Teto de duração de uma jornada, pra quebrar o pareamento.
 *
 * ⚠️ Sem isto, esquecer de bater a saída numa terça faz a marcação de terça
 * parear com a entrada de QUARTA e virar 24h trabalhadas. O par que passa do
 * teto não é par: a primeira marcação fica em aberto (que é a verdade — ele
 * não bateu a saída) e a seguinte abre jornada nova.
 *
 * 16h porque a jornada legal mais longa que existe na prática é 12x36, e 16h
 * já cobre 12h com hora extra sem engolir o esquecimento.
 */
export const MAX_DURACAO_JORNADA_MIN = 16 * 60;

const UM_MINUTO = 60_000;

/** "2026-09-20" da data civil de Brasília (UTC-3 fixo desde 2019). */
export function diaBR(d: Date): Ymd {
  const br = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const m = String(br.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(br.getUTCDate()).padStart(2, "0");
  return `${br.getUTCFullYear()}-${m}-${dia}`;
}

/**
 * Pareia as marcações de um PERÍODO, não de um dia.
 *
 * ⚠️ POR QUE NÃO É POR DIA, e isso derruba o desenho óbvio: motorista que
 * entra 21h e sai 05h, e plantão de oficina 12x36 noturno, são a jornada
 * NORMAL do público. Parear dentro do dia daria, todo dia, dois meios-pares:
 * um dia com entrada sem saída e o seguinte com saída sem entrada — 0h
 * trabalhadas e "a conferir" em metade do mês, com o gestor corrigindo na mão
 * justamente o trabalho que o módulo prometia acabar.
 *
 * A jornada inteira pertence ao dia da marcação de ABERTURA. É a regra que a
 * CLT usa e a que a folha espera.
 */
export function parearPeriodo(
  marcacoes: MarcacaoApurada[],
  opts: { maxJornadaMin?: number } = {},
): Par[] {
  const max = (opts.maxJornadaMin ?? MAX_DURACAO_JORNADA_MIN) * UM_MINUTO;
  const uteis = marcacoes
    .filter((m) => !m.desconsiderada)
    .slice()
    .sort((a, b) => a.marcadoEm.getTime() - b.marcadoEm.getTime());

  const pares: Par[] = [];
  let aberta: MarcacaoApurada | null = null;

  for (const m of uteis) {
    if (!aberta) {
      aberta = m;
      continue;
    }
    const dur = m.marcadoEm.getTime() - aberta.marcadoEm.getTime();
    if (dur > max) {
      // Passou do teto: não é o fechamento daquela jornada, é o começo de
      // outra. A anterior fica em aberto, que é a verdade.
      pares.push(emAberto(aberta));
      aberta = m;
      continue;
    }
    pares.push({
      entrada: aberta.marcadoEm,
      saida: m.marcadoEm,
      emAberto: false,
      minutos: Math.round(dur / UM_MINUTO),
      dia: diaBR(aberta.marcadoEm),
      numeros: [aberta.numero, m.numero],
      entradaIncluida: aberta.incluida === true,
      saidaIncluida: m.incluida === true,
    });
    aberta = null;
  }
  if (aberta) pares.push(emAberto(aberta));
  return pares;
}

function emAberto(m: MarcacaoApurada): Par {
  return {
    entrada: m.marcadoEm,
    saida: null,
    emAberto: true,
    minutos: 0,
    dia: diaBR(m.marcadoEm),
    numeros: [m.numero],
    entradaIncluida: m.incluida === true,
    saidaIncluida: false,
  };
}

/** Quanto o contrato esperava daquele dia. Feriado zera. */
export function previstoDoDia(jornada: JornadaDiaPura | null, feriado: boolean): number {
  if (!jornada || !jornada.trabalha || feriado) return 0;
  return jornada.cargaMin;
}

/**
 * A tolerância da Súmula 366 do TST / art. 58 §1º da CLT.
 *
 * ⚠️ O ERRO QUE QUASE TODO SISTEMA COMETE: passou de 5 minutos numa marcação
 * ou de 10 somados no dia, conta a jornada INTEIRA — não só o excedente. Quem
 * desconta só o que passou paga a diferença na liquidação de sentença, com
 * juros, anos depois, e ninguém lembra de onde veio.
 *
 * Dentro da tolerância, o excedente simplesmente não conta (pra mais nem pra
 * menos): é o que a lei chama de tempo à disposição irrelevante.
 */
export function aplicarTolerancia(
  previstoMin: number,
  realMin: number,
  tol: Tolerancia,
): { minutosConsiderados: number; estourou: boolean } {
  if (previstoMin <= 0) return { minutosConsiderados: realMin, estourou: realMin > 0 };

  const diferenca = realMin - previstoMin;
  const absoluta = Math.abs(diferenca);

  // Dentro da tolerância diária: vale o previsto, como se tivesse batido certo.
  if (absoluta <= tol.diariaMin && absoluta <= Math.max(tol.porMarcacaoMin * 2, tol.diariaMin)) {
    return { minutosConsiderados: previstoMin, estourou: false };
  }
  // Estourou: conta tudo o que realmente aconteceu, do primeiro minuto.
  return { minutosConsiderados: realMin, estourou: true };
}

/**
 * Apura um PERÍODO inteiro e devolve um resultado por dia.
 *
 * Recebe o período todo porque o pareamento atravessa a meia-noite (ver
 * `parearPeriodo`). Os dias sem marcação nenhuma também voltam, com os
 * alertas certos: dia que some do espelho é dia que ninguém confere.
 */
export function apurarPeriodo(e: {
  dias: Ymd[];
  marcacoes: MarcacaoApurada[];
  /** A jornada de cada dia, já resolvida (vínculo + modelo + posição). */
  jornadaPorDia: Map<Ymd, JornadaDiaPura | null>;
  feriados: Set<Ymd>;
  /** Desvio de relógio observado por marcação, quando houve. */
  desvioPorNumero?: Map<number, number>;
  /** Limite acima do qual o desvio de relógio vira alerta. */
  desvioToleradoSeg?: number;
  maxJornadaMin?: number;
  /**
   * Hoje, em São Paulo. Dia POSTERIOR a isto não tem previsto e não gera
   * alerta: o mês ainda está correndo, e contar o que não aconteceu faria o
   * espelho do dia 5 mostrar 168h de saldo negativo. Mesma lição do espelho
   * de diárias — dia futuro não pode parecer dívida.
   */
  hoje?: Ymd;
}): ApuracaoDia[] {
  const pares = parearPeriodo(e.marcacoes, { maxJornadaMin: e.maxJornadaMin });
  const porDia = new Map<Ymd, Par[]>();
  for (const p of pares) {
    porDia.set(p.dia, [...(porDia.get(p.dia) ?? []), p]);
  }

  // Marcações que caíram num dia fora do período pedido continuam existindo;
  // o que não pode é sumir da conta do dia a que pertencem.
  const desvioTolerado = e.desvioToleradoSeg ?? 300;

  return e.dias.map((dia) => {
    const doDia = porDia.get(dia) ?? [];
    const jornada = e.jornadaPorDia.get(dia) ?? null;
    const feriado = e.feriados.has(dia);
    const futuro = e.hoje != null && dia > e.hoje;
    // Dia que ainda não chegou: previsto zero. O contrato continua valendo,
    // mas ele só vira cobrança depois que o dia passa.
    const previsto = futuro ? 0 : previstoDoDia(jornada, feriado);

    let trabalhado = doDia.reduce((s, p) => s + p.minutos, 0);

    // Pré-assinalação do intervalo (art. 74 §2º): o ÚNICO pré-preenchimento
    // que a lei admite. Só desconta quando ligado, e aparece no espelho como
    // pré-assinalado — nunca disfarçado de marcação que a pessoa não fez.
    const pre = jornada?.preAssinalacaoMinutos ?? null;
    if (pre && doDia.length === 1 && !doDia[0]!.emAberto) {
      trabalhado = Math.max(0, trabalhado - pre);
    }

    const tol = jornada?.tolerancia ?? { porMarcacaoMin: 0, diariaMin: 0 };
    const { minutosConsiderados } = aplicarTolerancia(previsto, trabalhado, tol);

    const alertas: AlertaPonto[] = [];
    const abertos = doDia.filter((p) => p.emAberto);
    if (abertos.length > 0) {
      alertas.push({ codigo: "CONFERIR", numeros: abertos.flatMap((p) => p.numeros) });
    }
    if (previsto > 0 && doDia.length === 0) alertas.push({ codigo: "SEM_REGISTRO" });
    // Marcar em dia futuro é adiantar batida, não trabalhar em folga — e o
    // alerta de "registrou em dia sem previsão" mentiria sobre isso.
    if (!futuro && previsto === 0 && doDia.length > 0) {
      alertas.push({ codigo: "FORA_DA_JORNADA" });
    }

    // Intervalo: com dois pares, o buraco entre eles é o intervalo. Com um par
    // só e sem pré-assinalação, não houve intervalo registrado.
    const minimo = jornada?.intervaloMinimoMin ?? 0;
    if (minimo > 0 && previsto > 0 && doDia.length > 0) {
      const fechados = doDia.filter((p) => !p.emAberto);
      if (fechados.length >= 2) {
        const gap = Math.round(
          (fechados[1]!.entrada.getTime() - fechados[0]!.saida!.getTime()) / UM_MINUTO,
        );
        if (gap < minimo) alertas.push({ codigo: "SEM_INTERVALO", minimoMin: minimo });
      } else if (fechados.length === 1 && !pre && fechados[0]!.minutos > minimo + 240) {
        alertas.push({ codigo: "SEM_INTERVALO", minimoMin: minimo });
      }
    }

    for (const p of doDia) {
      for (const n of p.numeros) {
        const desvio = e.desvioPorNumero?.get(n);
        if (desvio != null && Math.abs(desvio) > desvioTolerado) {
          alertas.push({ codigo: "RELOGIO_DIVERGENTE", segundos: desvio });
        }
      }
    }

    return {
      dia,
      futuro,
      pares: doDia,
      minutosTrabalhados: trabalhado,
      minutosConsiderados,
      minutosPrevistos: previsto,
      saldoMin: minutosConsiderados - previsto,
      nomeModelo: jornada?.nomeModelo ?? "",
      alertas,
    };
  });
}

export type LimitesDirecao = {
  maxDirecaoContinuaMin?: number | null;
  interjornadaMin?: number | null;
  descansoSemanalMin?: number | null;
};

/**
 * As violações da Lei 13.103/2015 (jornada do motorista).
 *
 * ⚠️ ALERTA, NUNCA BLOQUEIO — nem da marcação, nem da viagem. O sistema que
 * impede o registro pra "não violar o limite" produz o pior documento
 * possível: a prova de que a empresa impediu o registro de sobrejornada.
 */
export function violacoesDeJornada(dias: ApuracaoDia[], limites: LimitesDirecao): AlertaPonto[] {
  const out: AlertaPonto[] = [];
  const ordenados = dias.slice().sort((a, b) => a.dia.localeCompare(b.dia));

  if (limites.maxDirecaoContinuaMin) {
    for (const d of ordenados) {
      for (const p of d.pares) {
        if (!p.emAberto && p.minutos > limites.maxDirecaoContinuaMin) {
          out.push({ codigo: "DIRECAO_CONTINUA", minutos: p.minutos });
        }
      }
    }
  }

  if (limites.interjornadaMin) {
    let fimAnterior: Date | null = null;
    for (const d of ordenados) {
      for (const p of d.pares) {
        if (fimAnterior && p.entrada > fimAnterior) {
          const descanso = Math.round((p.entrada.getTime() - fimAnterior.getTime()) / UM_MINUTO);
          if (descanso < limites.interjornadaMin) {
            out.push({ codigo: "INTERJORNADA_CURTA", minutos: descanso });
          }
        }
        if (p.saida) fimAnterior = p.saida;
      }
    }
  }

  return out;
}
