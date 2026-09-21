/**
 * Helpers de fuso horário para o backend.
 *
 * O container roda em UTC (sem TZ), então `new Date().setHours(0)` ancora o dia
 * em UTC e, a partir das 21h de Brasília (00h UTC), o "dia" pula pro seguinte —
 * telas zeram e viagens caem no dia errado. Estas funções ancoram tudo na data
 * civil de São Paulo (UTC-3, sem horário de verão desde 2019).
 *
 * Dois formatos de fronteira:
 *  - `*Data` → meia-noite UTC da data BR: casa com colunas @db.Date
 *    (Viagem.data, Pedagio.data — o Prisma as devolve como meia-noite UTC).
 *  - `*Instante` → meia-noite de Brasília em UTC (03:00Z): pra colunas timestamp
 *    (Abastecimento.data, ultimoLoginEm, criadoEm…).
 */

/** Componentes [ano, mes(1-12), dia] da data civil de São Paulo para um instante. */
export function ymdSaoPaulo(d: Date = new Date()): [number, number, number] {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // "YYYY-MM-DD"
  const [y, m, dia] = s.split("-").map(Number);
  return [y, m, dia];
}

/** Meia-noite UTC da data civil BR (para colunas @db.Date). */
export function inicioDoDiaData(d: Date = new Date()): Date {
  const [y, m, dia] = ymdSaoPaulo(d);
  return new Date(Date.UTC(y, m - 1, dia));
}

/** Meia-noite de Brasília (03:00Z) para um dado dia (para colunas timestamp). */
export function inicioDoDiaInstante(d: Date = new Date()): Date {
  const [y, m, dia] = ymdSaoPaulo(d);
  return new Date(Date.UTC(y, m - 1, dia, 3));
}

/**
 * Meia-noite UTC da data BR de N dias atrás — para janelas "últimos N dias"
 * em colunas @db.Date (ex.: viagens dos últimos 90 dias).
 */
export function inicioDiasAtras(n: number): Date {
  return new Date(inicioDoDiaData().getTime() - n * 86_400_000);
}

/**
 * Início do dia (00:00 de Brasília, em UTC = 03:00Z) de uma data "YYYY-MM-DD".
 * Para filtrar colunas timestamp por um range de datas civis BR vindo do client
 * (ex.: filtro de/até de abastecimentos). Use `lt` no dia seguinte pra incluir
 * o último dia inteiro: `inicioDoDiaBR(ate) + 1 dia`.
 */
export function inicioDoDiaBR(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3));
}

/** A hora cheia (0–23) em São Paulo. O container roda em UTC e `getHours()` mentiria. */
export function horaEmSaoPaulo(d: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(d),
  );
}

/** Dia da semana em São Paulo, no mesmo índice do `getDay()` (0 = domingo). */
export function diaDaSemanaEmSaoPaulo(d: Date = new Date()): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}

/** "14:35" no relógio de Brasília — pra texto que uma pessoa vai ler. */
export function horaMinutoSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** "12/09 às 07:10" — pra quando o dia já não é hoje e a hora sozinha confunde. */
export function dataHoraCurtaSaoPaulo(d: Date): string {
  const dia = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
  return `${dia} às ${horaMinutoSaoPaulo(d)}`;
}
