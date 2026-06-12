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
