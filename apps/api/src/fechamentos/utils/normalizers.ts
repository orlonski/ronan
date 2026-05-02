/**
 * Helpers de normalização — placas, datas, números brasileiros.
 */

export function normalizarPlaca(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(s)) return null;
  return s;
}

export function normalizarData(raw: unknown): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    // joga pra UTC date-only pra evitar timezone shifts
    return new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  }
  const s = String(raw).trim();
  // ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  // BR DD/MM/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let yy = Number(m[3]);
    if (yy < 100) yy += yy >= 50 ? 1900 : 2000;
    return new Date(Date.UTC(yy, Number(m[2]) - 1, Number(m[1])));
  }
  return null;
}

export function normalizarNumeroBR(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  // remove R$, espaços, etc
  s = s.replace(/[R$\s]/g, "");
  // pt-BR: 1.234,56 → 1234.56
  if (/,/.test(s) && /\./.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/,/.test(s)) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizarTicket(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  return String(raw).toUpperCase().trim() || null;
}
