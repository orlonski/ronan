/**
 * Helpers de data/hora consistentes em timezone local (Brasil UTC-3).
 *
 * Bug clássico: `new Date("2026-05-06")` é interpretado como UTC midnight.
 * Em UTC-3, getDate() retorna 5 (dia anterior). Esses helpers parseiam
 * "YYYY-MM-DD" como horário local pra evitar isso.
 */

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

/** "YYYY-MM-DD" do dia atual em horário LOCAL (não UTC). */
export function hojeISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
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
