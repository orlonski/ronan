/**
 * Em que acerto FECHADO (ou pago) um pedágio/abastecimento do motorista
 * entrou — pro "No acerto de DD/MM" de Meus gastos. Acerto ABERTO ainda é
 * rascunho do escritório: não vale como resposta pro motorista.
 */
export const ITENS_ACERTO_FECHADO = {
  where: { acerto: { status: { in: ["FECHADO" as const, "PAGO" as const] } } },
  select: { acerto: { select: { periodoFim: true, status: true, pagoEm: true } } },
  take: 1,
};

export type AcertoDoLancamento = {
  /** "YYYY-MM-DD" */
  periodoFim: string;
  status: "FECHADO" | "PAGO";
  pagoEm: string | null;
} | null;

export function acertoDoItem(
  item: { acerto: { periodoFim: Date; status: string; pagoEm: Date | null } } | null | undefined,
): AcertoDoLancamento {
  if (!item) return null;
  const a = item.acerto;
  if (a.status !== "FECHADO" && a.status !== "PAGO") return null;
  return {
    periodoFim: a.periodoFim.toISOString().slice(0, 10),
    status: a.status,
    pagoEm: a.pagoEm ? a.pagoEm.toISOString() : null,
  };
}
