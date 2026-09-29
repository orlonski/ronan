import type { Ymd } from "./ponto-jornada";
import { ymdSaoPaulo } from "./timezone";

// A descrição em português da regra mora em @ronan/shared-types
// (`descreverRegraConferencia`): a tela do painel a gera ao vivo do formulário e
// o servidor a grava no histórico — uma função, uma verdade.

/**
 * Conferência diária de viagens — a regra PURA (sem Prisma, sem relógio).
 *
 * Responde, por motorista, "ele provavelmente deixou de lançar viagem?". A
 * empresa-alvo não usa Pedido/ViagemPlanejada, então a única evidência é o
 * histórico de viagens que ele mesmo lançou.
 *
 * Regras de ouro:
 *  - HOJE NUNCA CONTA: o dia ainda não acabou, o motorista pode lançar à noite.
 *  - Só os dias em `diasConsiderados` (e que não sejam feriado nacional, se a
 *    empresa pediu) são "dia esperado de viagem". Domingo parado não é falha.
 *  - QUALQUER viagem lançada conta como "teve viagem", inclusive EM_ANDAMENTO,
 *    AGUARDANDO_PESO e INCOMPLETA: aqui a pergunta é "ele lançou algo?", não
 *    "o que ele lançou entra no fechamento?" — por isso NÃO se usa
 *    `STATUS_FORA_FECHAMENTO` (perguntar a quem tem viagem aberta seria erro).
 *  - Viagem EM_ANDAMENTO agora é movimento: não se pergunta.
 *  - Frequência: no máximo 1 pergunta a cada `intervaloMinimoDias` e
 *    `maxPerguntasPorSemana` nos últimos 7 dias, contando as perguntas
 *    anteriores (estado SOMBRA / enviadas — as suprimidas não contam).
 *  - Datas são Ymd (string) ancoradas em America/Sao_Paulo; nunca setHours.
 */

export type RegraConferencia = "SEM_VIAGEM_NO_DIA_ANTERIOR" | "SEM_VIAGEM_HA_N_DIAS";

export type ConfigRegraConferencia = {
  regra: RegraConferencia;
  /** N da regra SEM_VIAGEM_HA_N_DIAS. */
  diasSemViagem: number;
  /** 0 = domingo … 6 = sábado. */
  diasConsiderados: number[];
  ignorarFeriados: boolean;
  incluirQueNuncaLancou: boolean;
  intervaloMinimoDias: number;
  maxPerguntasPorSemana: number;
  /**
   * Regra de ATIVIDADE. Ausente ou 0 = desligada. Com N > 0, quem lançou a última
   * viagem há MAIS de N dias (qualquer status, hoje inclusive) não é perguntado:
   * vira `semMovimento`, pro escritório decidir se ainda trabalha aqui. Quem NUNCA
   * lançou não é afetado (segue só `incluirQueNuncaLancou`): a queixa que originou a
   * conferência inclui justamente o motorista que nunca lançou, e o cadastro recente
   * sem viagem cai nesse mesmo caso.
   */
  janelaAtividadeDias?: number;
};

export type MotoristaParaConferencia = {
  motoristaId: string;
  /** Dia (Ymd, SP) de cada viagem lançada, de qualquer status. Repetidos são ok. */
  diasComViagem: Ymd[];
  /** Tem viagem EM_ANDAMENTO neste instante. */
  temViagemEmAndamento: boolean;
  /** Dia (Ymd, SP) em que o cadastro nasceu; dias esperados anteriores não contam. */
  cadastradoEm?: Ymd | null;
  /** Dias (Ymd) em que ele JÁ FOI perguntado (ou seria, em sombra). */
  perguntasAnteriores: Ymd[];
};

export type EvidenciasConferencia = {
  hoje: Ymd;
  regra: RegraConferencia;
  /** Quantos dias esperados a regra olha (1 no "dia anterior", N na outra). */
  diasOlhados: number;
  /** Os dias esperados olhados, do mais recente ao mais antigo. */
  diasEsperadosVerificados: Ymd[];
  ultimoDiaComViagem: Ymd | null;
  nuncaLancou: boolean;
  temViagemEmAndamento: boolean;
  ultimaPergunta: Ymd | null;
  perguntasNaSemana: number;
  /** Só quando a regra de atividade barrou: há quantos dias foi a última viagem. */
  diasSemMovimento?: number;
};

export type ResultadoConferencia = {
  deveriaPerguntar: boolean;
  /** Barrado pela regra de atividade: não recebe mensagem e vai pra lista do escritório. */
  semMovimento?: boolean;
  motivo: string;
  evidencias: EvidenciasConferencia;
};

/** Até onde o cálculo olha pra trás procurando dias esperados. */
const LIMITE_VOLTA_DIAS = 60;
const DIA_MS = 86_400_000;

const NOMES_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function paraMs(y: Ymd): number {
  const [a, m, d] = y.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

function deMs(ms: number): Ymd {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Soma dias a uma data civil, sem passar por fuso. */
export function somarDias(y: Ymd, dias: number): Ymd {
  return deMs(paraMs(y) + dias * DIA_MS);
}

/** 0 = domingo. A data civil não tem fuso, então getUTCDay é exato. */
export function diaDaSemanaYmd(y: Ymd): number {
  return new Date(paraMs(y)).getUTCDay();
}

export function diasEntre(de: Ymd, ate: Ymd): number {
  return Math.round((paraMs(ate) - paraMs(de)) / DIA_MS);
}

/** "Hoje" em São Paulo como Ymd. `agora` é injetável pra teste. */
export function hojeYmd(agora: Date): Ymd {
  const [y, m, d] = ymdSaoPaulo(agora);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Os últimos `quantos` dias ESPERADOS antes de hoje: dia da semana dentro de
 * `diasConsiderados` e, se pedido, fora dos feriados. Do mais recente ao mais
 * antigo. Hoje nunca entra.
 */
export function diasEsperadosAntesDeHoje(
  hoje: Ymd,
  quantos: number,
  diasConsiderados: number[],
  feriados: ReadonlySet<Ymd> | null,
): Ymd[] {
  const achados: Ymd[] = [];
  for (let i = 1; i <= LIMITE_VOLTA_DIAS && achados.length < quantos; i++) {
    const dia = somarDias(hoje, -i);
    if (!diasConsiderados.includes(diaDaSemanaYmd(dia))) continue;
    if (feriados?.has(dia)) continue;
    achados.push(dia);
  }
  return achados;
}

function dataBR(y: Ymd): string {
  const [a, m, d] = y.split("-");
  return `${d}/${m}/${a}`;
}

export function avaliarConferenciaDiaria(
  cfg: ConfigRegraConferencia,
  m: MotoristaParaConferencia,
  feriadosNacionais: ReadonlySet<Ymd>,
  agora: Date,
): ResultadoConferencia {
  const hoje = hojeYmd(agora);
  const n = cfg.regra === "SEM_VIAGEM_NO_DIA_ANTERIOR" ? 1 : Math.max(1, cfg.diasSemViagem);

  const diasViagem = new Set(m.diasComViagem.filter((d) => d < hoje));
  const ultimoDiaComViagem = [...diasViagem].sort().at(-1) ?? null;
  const nuncaLancou = m.diasComViagem.length === 0;

  const esperadosTodos = diasEsperadosAntesDeHoje(
    hoje,
    n,
    cfg.diasConsiderados,
    cfg.ignorarFeriados ? feriadosNacionais : null,
  );
  // Dia anterior ao cadastro não é falta: ele nem tinha o app.
  const esperados = m.cadastradoEm ? esperadosTodos.filter((d) => d >= m.cadastradoEm!) : esperadosTodos;

  const ultimaPergunta = [...m.perguntasAnteriores].filter((d) => d < hoje).sort().at(-1) ?? null;
  const perguntasNaSemana = new Set(
    m.perguntasAnteriores.filter((d) => d < hoje && diasEntre(d, hoje) <= 6),
  ).size;

  const evidencias: EvidenciasConferencia = {
    hoje,
    regra: cfg.regra,
    diasOlhados: n,
    diasEsperadosVerificados: esperados,
    ultimoDiaComViagem,
    nuncaLancou,
    temViagemEmAndamento: m.temViagemEmAndamento,
    ultimaPergunta,
    perguntasNaSemana,
  };
  const nao = (motivo: string): ResultadoConferencia => ({ deveriaPerguntar: false, motivo, evidencias });

  if (m.temViagemEmAndamento) return nao("Tem viagem em andamento agora.");
  if (nuncaLancou && !cfg.incluirQueNuncaLancou) {
    return nao("Nunca lançou viagem e a regra não inclui quem nunca lançou.");
  }
  const janela = cfg.janelaAtividadeDias ?? 0;
  if (janela > 0 && !nuncaLancou) {
    // Olha TODAS as viagens, hoje inclusive: quem lançou hoje está em atividade,
    // mesmo que `ultimoDiaComViagem` (que ignora hoje) aponte pra bem antes.
    const ultimaAtividade = [...m.diasComViagem].sort().at(-1)!;
    const parado = diasEntre(ultimaAtividade, hoje);
    if (parado > janela) {
      return {
        deveriaPerguntar: false,
        semMovimento: true,
        motivo: `Sem viagem há mais de ${janela} dias (última em ${dataBR(ultimaAtividade)}).`,
        evidencias: { ...evidencias, diasSemMovimento: parado },
      };
    }
  }
  if (esperados.length < n) {
    // Sem dias esperados suficientes (cadastro recente, ou config sem dia útil
    // no período): sem base pra dizer que faltou viagem.
    return nao(
      esperados.length === 0
        ? "Não houve dia esperado de viagem no período (cadastro recente, feriado ou dia fora da regra)."
        : `Só ${esperados.length} dia esperado no período, e a regra pede ${n}.`,
    );
  }
  const comViagem = esperados.filter((d) => diasViagem.has(d));
  if (comViagem.length > 0) {
    return nao(
      n === 1
        ? `Lançou viagem em ${dataBR(comViagem[0])}.`
        : `Lançou viagem em ${dataBR(comViagem[0])}, dentro dos últimos ${n} dias esperados.`,
    );
  }
  if (ultimaPergunta && diasEntre(ultimaPergunta, hoje) < cfg.intervaloMinimoDias) {
    return nao(
      `Já foi perguntado em ${dataBR(ultimaPergunta)} (mínimo de ${cfg.intervaloMinimoDias} dia(s) entre perguntas).`,
    );
  }
  if (perguntasNaSemana >= cfg.maxPerguntasPorSemana) {
    return nao(`Já foi perguntado ${perguntasNaSemana} vez(es) nos últimos 7 dias (máximo ${cfg.maxPerguntasPorSemana}).`);
  }

  const ultimo = ultimoDiaComViagem ? `última viagem em ${dataBR(ultimoDiaComViagem)}` : "nunca lançou viagem";
  const periodo =
    n === 1
      ? `no dia esperado anterior (${dataBR(esperados[0])}, ${NOMES_DIAS[diaDaSemanaYmd(esperados[0])]})`
      : `nos últimos ${n} dias esperados (de ${dataBR(esperados[n - 1])} a ${dataBR(esperados[0])})`;
  return {
    deveriaPerguntar: true,
    motivo: `Sem viagem lançada ${periodo}; ${ultimo}.`,
    evidencias,
  };
}

/** Config do lembrete dentro do app (colunas de `ConfiguracaoConferenciaDiaria`). */
export type ConfigLembreteApp = {
  /** A conferência em si está ativa? Sem ela, nada de lembrete. */
  ativo: boolean;
  lembreteNoApp: boolean;
  lembreteParaQuem: "SO_QUEM_SAIU" | "TODOS_QUE_ATRASARAM";
  diasParaLembreteNoApp: number;
};

export type LembreteLancamento = { dias: number; desde: Ymd; calculadoEm: Ymd };

/** Teto da contagem mostrada: passado disso "há 30 dias" já diz tudo. */
const TETO_DIAS_LEMBRETE = 30;

/**
 * Lembrete DENTRO do app: "você está há N dias sem lançar viagem".
 *
 * Reaproveita `avaliarConferenciaDiaria` com a regra SEM_VIAGEM_HA_N_DIAS (N = dias
 * do lembrete) e a MESMA config de dias considerados, feriados, "nunca lançou" e
 * cadastro recente. Frequência da pergunta do WhatsApp não vale aqui (o card não é
 * mensagem), então `perguntasAnteriores` vai vazio.
 *
 * Devolve `null` quando não deve aparecer. Devolve o tamanho REAL da sequência
 * (até o teto), não só N, e o dia mais antigo dela (`desde`).
 */
export function avaliarLembreteNoApp(
  cfgRegra: ConfigRegraConferencia,
  cfgApp: ConfigLembreteApp,
  m: MotoristaParaConferencia & { receberConferenciaDiaria: boolean },
  feriadosNacionais: ReadonlySet<Ymd>,
  agora: Date,
): LembreteLancamento | null {
  if (!cfgApp.ativo || !cfgApp.lembreteNoApp) return null;
  if (cfgApp.lembreteParaQuem === "SO_QUEM_SAIU" && m.receberConferenciaDiaria) return null;

  const hoje = hojeYmd(agora);
  // Lançou hoje (o dia de hoje não conta na regra, mas o lembrete some na hora).
  if (m.diasComViagem.includes(hoje)) return null;

  const n = Math.max(1, Math.floor(cfgApp.diasParaLembreteNoApp));
  const r = avaliarConferenciaDiaria(
    {
      ...cfgRegra,
      regra: "SEM_VIAGEM_HA_N_DIAS",
      diasSemViagem: n,
      intervaloMinimoDias: 1,
      maxPerguntasPorSemana: 7,
      // O card no app não é mensagem de WhatsApp: a regra de atividade protege o número, não vale aqui.
      janelaAtividadeDias: 0,
    },
    { ...m, perguntasAnteriores: [] },
    feriadosNacionais,
    agora,
  );
  if (!r.deveriaPerguntar) return null;

  const comViagem = new Set(m.diasComViagem);
  const esperados = diasEsperadosAntesDeHoje(
    hoje,
    TETO_DIAS_LEMBRETE,
    cfgRegra.diasConsiderados,
    cfgRegra.ignorarFeriados ? feriadosNacionais : null,
  ).filter((d) => !m.cadastradoEm || d >= m.cadastradoEm);
  const sequencia: Ymd[] = [];
  for (const d of esperados) {
    if (comViagem.has(d)) break;
    sequencia.push(d);
  }
  if (sequencia.length < n) return null;
  return { dias: sequencia.length, desde: sequencia[sequencia.length - 1]!, calculadoEm: hoje };
}
