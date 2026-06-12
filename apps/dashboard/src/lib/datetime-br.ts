/**
 * Helpers de data ancorados no fuso de Brasília (America/Sao_Paulo, UTC-3).
 *
 * No client roda no fuso do navegador (em geral já é o Brasil), mas em render
 * no servidor (RSC) o processo roda em UTC — aí `new Date().getMonth()` pode
 * apontar pro dia/mês errado perto da virada. Ancorar em São Paulo deixa o
 * resultado correto independente de onde o código rode.
 */

/** Componentes [ano, mes(1-12), dia] da data civil de São Paulo. */
export function ymdSaoPaulo(d: Date = new Date()): [number, number, number] {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // "YYYY-MM-DD"
  const parts = s.split("-");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Primeiro dia do mês civil de SP em "YYYY-MM-DD". */
export function primeiroDiaDoMesSP(): string {
  const [y, m] = ymdSaoPaulo();
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Último dia do mês civil de SP em "YYYY-MM-DD". */
export function ultimoDiaDoMesSP(): string {
  const [y, m] = ymdSaoPaulo();
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate(); // dia 0 do mês seguinte
  return `${y}-${String(m).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;
}

// ===== Exibição de TIMESTAMPS (instantes) em horário de Brasília =====
// Use estes pra colunas DateTime (criadoEm, sincronizadoEm, abastecimento.data…).
// NÃO use em colunas @db.Date (viagem.data, pedagio.data, períodos de fechamento):
// essas chegam como meia-noite UTC e devem ser exibidas em UTC (ex.: fmtBR), senão
// voltam um dia no Brasil.

const TZ_SP = "America/Sao_Paulo";

/** Partes zero-padded de um instante no horário de Brasília (24h). */
export function partesSP(d: Date): {
  dia: string;
  mes: string;
  ano: string;
  hora: string;
  min: string;
  seg: string;
} {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ_SP,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { dia: g("day"), mes: g("month"), ano: g("year"), hora: g("hour"), min: g("minute"), seg: g("second") };
}

/** Timestamp → "dd/mm/yyyy hh:mm" em horário de Brasília. */
export function fmtDataHoraSP(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const t = partesSP(date);
  return `${t.dia}/${t.mes}/${t.ano} ${t.hora}:${t.min}`;
}
