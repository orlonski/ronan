/**
 * O ESPELHO: quantos dias o contrato esperava e quantos o caminhão esteve lá.
 *
 * É a peça que muda a conversa do dia 20. Hoje a medição chega preenchida à
 * mão pelo contratante e a transportadora não tem com o que comparar — ela
 * pergunta no grupo de WhatsApp e espera. Com o espelho, ela chega na conversa
 * com um documento próprio.
 *
 * ⚠️ Isto NÃO é apuração de jornada e não produz falta. "Dia em branco" é dia
 * que ninguém marcou — pode ser que o caminhão não foi, pode ser que o
 * motorista esqueceu de tocar. O sistema não sabe a diferença e não finge que
 * sabe: ele mostra, e quem resolve é gente. Tratar dia em branco como falta
 * seria o produto testemunhando contra um parceiro autônomo.
 *
 * Regra pura de propósito: nada de Prisma aqui. Recebe datas e devolve contas,
 * o que torna cada caso testável sem banco — do mesmo jeito que
 * `viagem-minimos` e `acerto-motorista`.
 */

/** Um dia em "AAAA-MM-DD". Nunca Date solto: Date carrega fuso e aqui não tem. */
export type Ymd = string;

export type CompetenciaMensal = {
  /** "2026-09" — o mês em que a medição chega. */
  rotulo: string;
  /** Primeiro dia do período apurado. */
  de: Ymd;
  /** Último dia, que é o dia de corte. */
  ate: Ymd;
};

/**
 * O período que a medição do dia N cobre.
 *
 * Com corte 20, a competência de setembro vai de 21/08 a 20/09 — é o que o
 * contratante está medindo quando manda o papel no dia 20. Chumbar o 20 aqui
 * faria o próximo contratante exigir deploy; ele vem da configuração dele.
 */
export function competenciaDe(rotulo: string, diaCorte: number): CompetenciaMensal {
  const [ano, mes] = rotulo.split("-").map(Number);
  if (!ano || !mes) throw new Error(`Competência inválida: ${rotulo}`);

  // O dia é limitado ANTES de virar Date, em cada mês separadamente.
  //
  // Duas armadilhas aqui, as duas pagas em teste. `Date.UTC(2026, 8, 31)` já
  // rola pra outubro sozinho, então limitar depois corrige no mês errado. E o
  // início NÃO é "o fim menos um mês mais um dia": com corte 31, setembro
  // fecha em 30/09 (o mês não tem 31), mas agosto fechou em 31/08 — então
  // setembro começa em 01/09, não em 31/08. Derivar o início do fim recontaria
  // um dia que já foi medido e pago no mês anterior.
  const corteDoMes = (a: number, m: number) =>
    new Date(Date.UTC(a, m - 1, Math.min(diaCorte, new Date(Date.UTC(a, m, 0)).getUTCDate())));

  const ate = corteDoMes(ano, mes);
  const anterior = corteDoMes(mes === 1 ? ano - 1 : ano, mes === 1 ? 12 : mes - 1);
  const de = new Date(anterior.getTime() + 86_400_000);

  return { rotulo, de: ymd(de), ate: ymd(ate) };
}

export function ymd(d: Date): Ymd {
  return d.toISOString().slice(0, 10);
}

/** Todos os dias do intervalo, inclusive as duas pontas. */
export function diasDoIntervalo(de: Ymd, ate: Ymd): Ymd[] {
  const out: Ymd[] = [];
  const fim = Date.parse(`${ate}T00:00:00.000Z`);
  for (let t = Date.parse(`${de}T00:00:00.000Z`); t <= fim; t += 86_400_000) {
    out.push(ymd(new Date(t)));
  }
  return out;
}

/** 0 = domingo. */
export function diaDaSemana(d: Ymd): number {
  return new Date(`${d}T00:00:00.000Z`).getUTCDay();
}

export type EntradaEspelho = {
  /** O período apurado. */
  competencia: CompetenciaMensal;
  /** Dias da semana que o contrato espera (0 = domingo). */
  diasEsperadosSemana: number[];
  /** Vigência da alocação, pra não cobrar dia antes de ela começar. */
  inicio: Ymd;
  fim?: Ymd | null;
  /** Os dias efetivamente registrados, com quem marcou. */
  registrados: { data: Ymd; origem: "APP" | "PAINEL" }[];
};

export type Espelho = {
  /** Dias em que o contrato esperava o caminhão, dentro da vigência. */
  esperados: Ymd[];
  /** Dias com registro, esperados ou não. */
  registrados: Ymd[];
  /** Esperados que ninguém marcou. NÃO são faltas. */
  emBranco: Ymd[];
  /**
   * Registrados que o calendário não esperava — sábado numa obra de segunda a
   * sexta, por exemplo.
   *
   * Aparecem SEPARADOS em vez de somados ou escondidos: escondidos, o
   * motorista trabalharia de graça; somados no total, a transportadora
   * cobraria um dia que o contrato não previa e descobriria na recusa da
   * medição. Os dois erros custam caro, e são erros diferentes.
   */
  foraDoCalendario: Ymd[];
  /** Quantos dias entram na conta: esperados que foram marcados. */
  diasNoContrato: number;
  /** Quantos vieram do aparelho do motorista — a prova forte. */
  diasMarcadosPeloMotorista: number;
};

/**
 * Monta o espelho de UMA alocação num período.
 *
 * A ordem importa: primeiro o que o contrato esperava (calendário ∩ vigência),
 * depois o que aconteceu. Inverter isso faria o sistema descobrir o contrato a
 * partir do comportamento — e aí um mês em que ninguém marcou nada pareceria
 * um mês sem obrigação nenhuma.
 */
export function montarEspelho(e: EntradaEspelho): Espelho {
  const dentroDaVigencia = (d: Ymd) => d >= e.inicio && (!e.fim || d <= e.fim);

  const esperados = diasDoIntervalo(e.competencia.de, e.competencia.ate)
    .filter(dentroDaVigencia)
    .filter((d) => e.diasEsperadosSemana.includes(diaDaSemana(d)));

  const noPeriodo = e.registrados.filter(
    (r) => r.data >= e.competencia.de && r.data <= e.competencia.ate,
  );
  const registrados = noPeriodo.map((r) => r.data).sort();
  const setEsperados = new Set(esperados);
  const setRegistrados = new Set(registrados);

  return {
    esperados,
    registrados,
    emBranco: esperados.filter((d) => !setRegistrados.has(d)),
    foraDoCalendario: registrados.filter((d) => !setEsperados.has(d)),
    diasNoContrato: esperados.filter((d) => setRegistrados.has(d)).length,
    diasMarcadosPeloMotorista: noPeriodo.filter((r) => r.origem === "APP").length,
  };
}
