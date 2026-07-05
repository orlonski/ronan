/**
 * Formata um número (vindo como string do backend, ex: "12.5") com N casas
 * decimais no padrão pt-BR ("12,50"). Devolve o valor cru se não for número.
 */
export function fmtNum(v: string | null | undefined, casas: number): string {
  if (v == null) return "—";
  const n = parseFloat(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}
