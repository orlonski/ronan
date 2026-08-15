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

/** Timestamp → "hh:mm" em horário de Brasília. Usado nos horários da diária. */
export function fmtHoraSP(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const t = partesSP(date);
  return `${t.hora}:${t.min}`;
}

/**
 * "07:12 → 11:32" da diária, marcando quando a saída caiu em outro dia
 * (turno que vira a noite). Sem a marca, "22:10 → 06:30" parece erro de
 * digitação em vez de uma diária de 8h.
 */
export function fmtPeriodoSP(
  entradaEm: string | Date | null | undefined,
  saidaEm: string | Date | null | undefined,
): string {
  if (!entradaEm) return "—";
  const entrada = typeof entradaEm === "string" ? new Date(entradaEm) : entradaEm;
  if (!saidaEm) return `${fmtHoraSP(entrada)} → em aberto`;
  const saida = typeof saidaEm === "string" ? new Date(saidaEm) : saidaEm;
  const virou = partesSP(entrada).dia !== partesSP(saida).dia;
  return `${fmtHoraSP(entrada)} → ${fmtHoraSP(saida)}${virou ? " (+1d)" : ""}`;
}

/**
 * Offset de Brasília, em minutos, PARA UM INSTANTE específico.
 *
 * Lido do Intl em vez de fixar -180: o Brasil não tem horário de verão hoje,
 * mas datas antigas têm, e uma diária lançada em 2018 não pode deslizar uma
 * hora só porque a regra mudou depois.
 */
function offsetSPMinutos(d: Date): number {
  const parte = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ_SP,
    timeZoneName: "longOffset",
  })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(parte ?? "");
  if (!m) return -180;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Instante → "YYYY-MM-DDTHH:mm" pro <input type="datetime-local">, em SP. */
export function paraInputDataHoraSP(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  const t = partesSP(date);
  return `${t.ano}-${t.mes}-${t.dia}T${t.hora}:${t.min}`;
}

/**
 * "YYYY-MM-DDTHH:mm" digitado como hora de Brasília → instante ISO (UTC).
 *
 * O <input type="datetime-local"> não carrega fuso: o que o admin digitou é
 * hora de obra, hora do Brasil. Sem esta conversão o valor seria interpretado
 * no fuso do servidor (UTC no container) e a diária mudaria de hora sozinha.
 */
export function isoDeInputDataHoraSP(valor: string): string | null {
  if (!valor) return null;
  const comoUtc = new Date(`${valor}:00Z`);
  if (Number.isNaN(comoUtc.getTime())) return null;
  return new Date(comoUtc.getTime() - offsetSPMinutos(comoUtc) * 60000).toISOString();
}
