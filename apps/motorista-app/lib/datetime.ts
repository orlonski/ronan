/**
 * Helpers de data/hora consistentes em timezone local (Brasil UTC-3).
 *
 * Bug clássico: `new Date("2026-05-06")` é interpretado como UTC midnight.
 * Em UTC-3, getDate() retorna 5 (dia anterior). Esses helpers parseiam
 * "YYYY-MM-DD" como horário local pra evitar isso.
 */

/** Brasília é UTC-3 fixo desde o fim do horário de verão, em 2019. */
const OFFSET_BR_MS = 3 * 60 * 60 * 1000;

/** Aceita "YYYY-MM-DD" ou ISO completo. Sempre devolve Date no fuso local. */
export function parseDataLocal(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  // Se for ISO completo (com T), usa as funções getUTC* pra extrair o dia
  // que o backend mandou (já que ele queria DD/MM/YYYY como label, não
  // localizado pelo cliente).
  const full = /^(\d{4})-(\d{2})-(\d{2})T/.exec(iso);
  if (full) {
    return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Anda `n` dias sobre um "YYYY-MM-DD", sem passar perto de fuso nenhum.
 *
 * A aritmética é feita em UTC de propósito: a string não representa um
 * instante, representa um dia do calendário, e somar 1 a "2026-10-31" tem que
 * dar "2026-11-01" em qualquer aparelho.
 */
export function somarDiasISO(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const r = new Date(Date.UTC(a!, (m ?? 1) - 1, (d ?? 1) + n));
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

/** "06/05" */
export function fmtDataCurta(iso: string): string {
  const d = parseDataLocal(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

/** "06/05/2026" */
export function fmtDataBR(iso: string): string {
  const d = parseDataLocal(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

/**
 * "YYYY-MM-DD" de HOJE, no calendário de BRASÍLIA.
 *
 * Nem UTC, nem o fuso do aparelho — os dois já erraram aqui.
 *
 * UTC erra a partir das 21h: pedágio pago às 22h de terça nasceria com a data
 * de quarta. E o fuso do aparelho erra porque um motorista real estava com o
 * celular em ~UTC-6 (relógio absoluto certo, timezone torto): pra ele,
 * qualquer coisa lançada depois das 21h ia com a data de ontem.
 *
 * Brasília é UTC-3 fixo desde que o Brasil acabou com o horário de verão, em
 * 2019, então o deslocamento constante resolve — e é independente do que o
 * aparelho acha que é o fuso dele.
 */
export function hojeISO(): string {
  const br = new Date(Date.now() - OFFSET_BR_MS);
  const m = String(br.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(br.getUTCDate()).padStart(2, "0");
  return `${br.getUTCFullYear()}-${m}-${dia}`;
}

/** "06/05 14:30" — data curta + hora (horário do device). */
export function fmtDataHoraCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes} ${hh}:${mm}`;
}

/** "06/05/2026 14:30" */
export function fmtDataHora(iso: string): string {
  const d = new Date(iso); // ISO com timezone explícito é OK
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()} ${hora}:${min}`;
}

// ===== Hora de Brasília =====
// A hora que aparece aqui é a MESMA que sai no painel, então ela é ancorada no
// horário de Brasília — não no fuso do aparelho. Celular com fuso torto
// acontece (já custou caro em outro ponto do app, ver posicao-periodica.ts), e
// nesse caso a tela mostraria uma hora que não bate com o que a empresa vê.
//
// O instante em si é sempre absoluto (Date.now()), então só a EXIBIÇÃO precisa
// desse cuidado. -3h fixo: o Brasil não tem horário de verão desde 2019.

function partesBR(iso: string): { dia: string; mes: string; hh: string; mm: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const br = new Date(d.getTime() - OFFSET_BR_MS);
  return {
    dia: String(br.getUTCDate()).padStart(2, "0"),
    mes: String(br.getUTCMonth() + 1).padStart(2, "0"),
    hh: String(br.getUTCHours()).padStart(2, "0"),
    mm: String(br.getUTCMinutes()).padStart(2, "0"),
  };
}

/** "07:12" em horário de Brasília. */
export function fmtHoraBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = partesBR(iso);
  return p ? `${p.hh}:${p.mm}` : "—";
}

/**
 * "YYYY-MM-DD" + "HH:MM" (hora de Brasília) → ISO do instante.
 * Devolve null se a hora não estiver completa/válida — o chamador decide o que
 * fazer, em vez de gravar uma data inventada.
 */
export function isoDeDataHoraBR(dataISO: string, hora: string): string | null {
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataISO);
  const mh = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!md || !mh) return null;
  const hh = Number(mh[1]);
  const mm = Number(mh[2]);
  if (hh > 23 || mm > 59) return null;
  const utcMs =
    Date.UTC(Number(md[1]), Number(md[2]) - 1, Number(md[3]), hh, mm) + OFFSET_BR_MS;
  return new Date(utcMs).toISOString();
}

/** Duração em minutos entre dois ISO. Negativa quando a saída veio antes. */
export function minutosEntre(entradaISO: string, saidaISO: string): number | null {
  const e = new Date(entradaISO).getTime();
  const s = new Date(saidaISO).getTime();
  if (Number.isNaN(e) || Number.isNaN(s)) return null;
  return Math.round((s - e) / 60000);
}

/** Um dia inteiro em ms — pra empurrar a hora que virou a noite. */
export const UM_DIA_MS = 24 * 60 * 60 * 1000;
