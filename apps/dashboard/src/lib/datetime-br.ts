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
