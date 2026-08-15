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

// ===== Diária (serviço medido por período) =====
// A hora que aparece aqui é a MESMA que sai no painel e no comprovante do
// cliente, então ela é ancorada no horário de Brasília — não no fuso do
// aparelho. Celular com fuso torto acontece (já custou caro em outro ponto do
// app, ver posicao-periodica.ts), e nesse caso a diária mostraria uma hora que
// não bate com o que a empresa vê.
//
// O instante em si é sempre absoluto (Date.now()), então só a EXIBIÇÃO precisa
// desse cuidado. -3h fixo: o Brasil não tem horário de verão desde 2019.
const OFFSET_BR_MS = 3 * 60 * 60 * 1000;

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
 * "07:12 → 11:32" da diária, marcando a virada de dia. Sem o "+1d",
 * "22:10 → 06:30" parece erro em vez de uma diária de 8h.
 */
export function fmtPeriodoBR(
  entradaEm: string | null | undefined,
  saidaEm: string | null | undefined,
): string {
  if (!entradaEm) return "—";
  if (!saidaEm) return `${fmtHoraBR(entradaEm)} → em aberto`;
  const e = partesBR(entradaEm);
  const s = partesBR(saidaEm);
  if (!e || !s) return "—";
  const virou = e.dia !== s.dia;
  return `${e.hh}:${e.mm} → ${s.hh}:${s.mm}${virou ? " (+1d)" : ""}`;
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

/** Um dia inteiro em ms — pra empurrar a saída da diária que virou a noite. */
export const UM_DIA_MS = 24 * 60 * 60 * 1000;
