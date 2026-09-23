import type { ApuracaoDia, JornadaDiaPura, Ymd } from "./ponto-jornada";

/**
 * O ESPELHO DE PONTO: o calendário do mês, dia a dia, do jeito que o
 * trabalhador confere e a fiscalização lê.
 *
 * Regra pura, como a apuração. E o calendário vem COMPLETO, com os dias em
 * branco presentes: dia que some do espelho é dia que ninguém confere.
 */

export type CompetenciaPonto = { rotulo: string; de: Ymd; ate: Ymd };

function ymd(d: Date): Ymd {
  return d.toISOString().slice(0, 10);
}

/**
 * O período de uma competência, pelo dia de fechamento da empresa.
 *
 * As duas armadilhas desta conta, pagas em teste:
 *
 * 1. O dia é limitado ANTES de virar Date. `Date.UTC(2026, 8, 31)` já rola pra
 *    outubro sozinho, então limitar depois corrige no mês errado.
 * 2. O início NÃO é "o fim menos um mês mais um dia". Com fechamento 31,
 *    setembro fecha em 30/09 (o mês não tem 31) mas agosto fechou em 31/08 —
 *    setembro começa em 01/09. Derivar o início do fim recontaria um dia que
 *    já foi apurado e pago no mês anterior.
 */
export function competenciaPonto(rotulo: string, diaFechamento: number): CompetenciaPonto {
  const [ano, mes] = rotulo.split("-").map(Number);
  if (!ano || !mes) throw new Error(`Competência inválida: ${rotulo}`);

  const corteDoMes = (a: number, m: number) =>
    new Date(Date.UTC(a, m - 1, Math.min(diaFechamento, new Date(Date.UTC(a, m, 0)).getUTCDate())));

  const ate = corteDoMes(ano, mes);
  const anterior = corteDoMes(mes === 1 ? ano - 1 : ano, mes === 1 ? 12 : mes - 1);
  const de = new Date(anterior.getTime() + 86_400_000);

  return { rotulo, de: ymd(de), ate: ymd(ate) };
}

/** Todos os dias do período, em ordem. */
export function diasDoPeriodo(de: Ymd, ate: Ymd): Ymd[] {
  const out: Ymd[] = [];
  const fim = Date.parse(`${ate}T00:00:00.000Z`);
  for (let t = Date.parse(`${de}T00:00:00.000Z`); t <= fim; t += 86_400_000) {
    out.push(ymd(new Date(t)));
  }
  return out;
}

export type VinculoPuro = {
  vigenteDe: Ymd;
  vigenteAte: Ymd | null;
  modeloNome: string;
  tipo: "SEMANAL" | "CICLO";
  cicloDias: number | null;
  ancoraCiclo: Ymd | null;
  tolerancia: { porMarcacaoMin: number; diariaMin: number };
  intervaloMinimoMin: number;
  preAssinalacaoMinutos: number | null;
  /** Uma entrada por posição (0..6 no semanal, 0..cicloDias-1 no ciclo). */
  dias: {
    posicao: number;
    trabalha: boolean;
    entrada: string | null;
    saida: string | null;
    intervaloMin: number;
    cargaMin: number;
  }[];
};

/** 0=domingo. Calculado em UTC a partir do "AAAA-MM-DD", sem passar por fuso. */
function diaDaSemana(dia: Ymd): number {
  return new Date(`${dia}T00:00:00.000Z`).getUTCDay();
}

/**
 * Qual jornada valia naquele dia.
 *
 * `null` quando não havia vínculo — e isso NÃO é o mesmo que folga: é
 * "ninguém disse qual é a jornada dessa pessoa", que trava o fechamento em
 * vez de inventar previsto zero.
 */
export function jornadaDoDia(dia: Ymd, vinculos: VinculoPuro[]): JornadaDiaPura | null {
  const v = vinculos.find((x) => dia >= x.vigenteDe && (!x.vigenteAte || dia <= x.vigenteAte));
  if (!v) return null;

  let posicao: number;
  if (v.tipo === "CICLO" && v.cicloDias && v.ancoraCiclo) {
    const dias = Math.floor(
      (Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${v.ancoraCiclo}T00:00:00Z`)) / 86_400_000,
    );
    // Módulo que funciona com negativo: dia anterior à âncora não pode virar
    // posição negativa e cair fora da tabela.
    posicao = ((dias % v.cicloDias) + v.cicloDias) % v.cicloDias;
  } else {
    posicao = diaDaSemana(dia);
  }

  const d = v.dias.find((x) => x.posicao === posicao);
  if (!d) return null;

  return {
    trabalha: d.trabalha,
    entrada: d.entrada,
    saida: d.saida,
    intervaloMin: d.intervaloMin,
    cargaMin: d.trabalha ? d.cargaMin : 0,
    nomeModelo: v.modeloNome,
    tolerancia: v.tolerancia,
    intervaloMinimoMin: v.intervaloMinimoMin,
    preAssinalacaoMinutos: v.preAssinalacaoMinutos,
  };
}

export type FeriadoPuro = {
  data: Ymd;
  abrangencia: "NACIONAL" | "ESTADUAL" | "MUNICIPAL";
  uf: string | null;
  municipioIbge: string | null;
};

/** Feriado alcança esta pessoa? Estadual e municipal dependem de onde ela está. */
export function feriadoAlcanca(
  f: FeriadoPuro,
  uf?: string | null,
  municipioIbge?: string | null,
): boolean {
  if (f.abrangencia === "NACIONAL") return true;
  if (f.abrangencia === "ESTADUAL") return !!uf && f.uf === uf;
  return !!municipioIbge && f.municipioIbge === municipioIbge;
}

export type EspelhoPonto = {
  funcionarioId: string;
  nome: string;
  competencia: CompetenciaPonto;
  dias: ApuracaoDia[];
  totalPrevistoMin: number;
  totalTrabalhadoMin: number;
  totalConsideradoMin: number;
  saldoMin: number;
  diasParaConferir: number;
};

/**
 * Monta o espelho, recortando pelo contrato.
 *
 * Dia antes da admissão ou depois do desligamento sai do documento — mas o
 * dia em branco DENTRO do contrato fica, com o alerta. O espelho é a peça que
 * a pessoa confere; esconder linha dela é tirar o que ela tem pra conferir.
 */
export function montarEspelhoPonto(e: {
  funcionarioId: string;
  nome: string;
  competencia: CompetenciaPonto;
  admitidoEm: Ymd;
  desligadoEm?: Ymd | null;
  dias: ApuracaoDia[];
}): EspelhoPonto {
  const dentro = e.dias.filter(
    (d) => d.dia >= e.admitidoEm && (!e.desligadoEm || d.dia <= e.desligadoEm),
  );

  const soma = (f: (d: ApuracaoDia) => number) => dentro.reduce((s, d) => s + f(d), 0);

  return {
    funcionarioId: e.funcionarioId,
    nome: e.nome,
    competencia: e.competencia,
    dias: dentro,
    totalPrevistoMin: soma((d) => d.minutosPrevistos),
    totalTrabalhadoMin: soma((d) => d.minutosTrabalhados),
    totalConsideradoMin: soma((d) => d.minutosConsiderados),
    saldoMin: soma((d) => d.saldoMin),
    diasParaConferir: dentro.filter((d) =>
      d.alertas.some((a) => a.codigo === "CONFERIR" || a.codigo === "SEM_REGISTRO"),
    ).length,
  };
}

/** A visão da COMPETÊNCIA INTEIRA, que vem antes da visão de uma pessoa. */
export function resumoDaCompetencia(
  pessoas: (EspelhoPonto & { semJornada: boolean; correcoesPendentes: number })[],
) {
  return {
    totalPessoas: pessoas.length,
    comPendencia: pessoas.filter(
      (p) => p.diasParaConferir > 0 || p.correcoesPendentes > 0 || p.semJornada,
    ).length,
    linhas: pessoas.map((p) => ({
      funcionarioId: p.funcionarioId,
      nome: p.nome,
      saldoMin: p.saldoMin,
      diasParaConferir: p.diasParaConferir,
      correcoesPendentes: p.correcoesPendentes,
      semJornada: p.semJornada,
    })),
  };
}

/** "-1h20" / "+8h05" / "0h00". O espelho é lido por gente, não por máquina. */
export function formatarMinutos(min: number): string {
  const sinal = min < 0 ? "-" : min > 0 ? "+" : "";
  const abs = Math.abs(min);
  return `${sinal}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Os feriados nacionais de um ano, inclusive os móveis.
 *
 * ⚠️ Existe porque a alternativa é a conta nascer com 12 dias de falta falsa
 * por ano, atingindo a empresa inteira no primeiro mês — e é isso que destrói
 * a confiança no número, que é a única coisa que o módulo vende.
 *
 * Constante no código como SEMENTE, editável na tela depois: é a regra da
 * casa. Estadual e municipal continuam sendo cadastro, porque não há lista
 * nacional confiável deles.
 */
export function feriadosNacionais(ano: number): { data: Ymd; nome: string }[] {
  const pascoa = domingoDePascoa(ano);
  const desloca = (dias: number) => ymd(new Date(pascoa.getTime() + dias * 86_400_000));

  return [
    { data: `${ano}-01-01`, nome: "Confraternização Universal" },
    { data: desloca(-48), nome: "Carnaval" },
    { data: desloca(-47), nome: "Carnaval" },
    { data: desloca(-2), nome: "Sexta-feira Santa" },
    { data: `${ano}-04-21`, nome: "Tiradentes" },
    { data: `${ano}-05-01`, nome: "Dia do Trabalho" },
    { data: desloca(60), nome: "Corpus Christi" },
    { data: `${ano}-09-07`, nome: "Independência do Brasil" },
    { data: `${ano}-10-12`, nome: "Nossa Senhora Aparecida" },
    { data: `${ano}-11-02`, nome: "Finados" },
    { data: `${ano}-11-15`, nome: "Proclamação da República" },
    { data: `${ano}-11-20`, nome: "Consciência Negra" },
    { data: `${ano}-12-25`, nome: "Natal" },
  ];
}

/** Algoritmo de Meeus/Jones/Butcher. Puro, e testado contra datas conhecidas. */
function domingoDePascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * mm + 114) / 31);
  const dia = ((h + l - 7 * mm + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}
