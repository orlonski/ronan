/**
 * Documento do motorista ou do caminhão vencendo — do lado do GESTOR.
 *
 * O motorista já é avisado dos documentos da carteira dele
 * (frete-pessoal/aviso-documentos.service.ts). Faltava o escritório saber,
 * na hora em que programa o dia, que a CNH do Zé vence sexta ou que o CRLV do
 * ABC-1D23 já venceu. Os concorrentes de granel (Tread, HaulHub) mostram isso
 * no despacho.
 *
 * Só AVISA. Não bloqueia programação nem viagem: a regra da casa é aceitar e
 * carimbar, e quem decide se o caminhão sai é o escritório.
 */

/** A partir de quantos dias antes o documento aparece como "vence logo". */
export const JANELA_AVISO_DIAS = 15;

/**
 * Em quais dias o sininho toca. Sem guardar estado: o mesmo documento avisa
 * com 15 dias, com 7, na véspera e no dia — e nunca duas vezes no mesmo dia.
 */
export const DIAS_DE_AVISAR = [15, 7, 1, 0] as const;

export type SituacaoDocumento = "VENCIDO" | "VENCE_LOGO";

/** Dias de hoje até a validade (`@db.Date`, meia-noite UTC). Negativo = venceu. */
export function diasParaVencer(validade: Date, hojeYmd: string): number {
  const v = Date.UTC(validade.getUTCFullYear(), validade.getUTCMonth(), validade.getUTCDate());
  const h = Date.parse(`${hojeYmd}T00:00:00Z`);
  return Math.round((v - h) / 86_400_000);
}

export function situacaoDocumento(
  validade: Date | null,
  hojeYmd: string,
): { situacao: SituacaoDocumento; dias: number } | null {
  if (!validade) return null;
  const dias = diasParaVencer(validade, hojeYmd);
  if (dias < 0) return { situacao: "VENCIDO", dias };
  if (dias <= JANELA_AVISO_DIAS) return { situacao: "VENCE_LOGO", dias };
  return null;
}

/** "CNH vencida há 3 dias", "CNH vence hoje", "CRLV vence em 5 dias". */
export function textoVencimento(rotulo: string, dias: number): string {
  if (dias < -1) return `${rotulo} venceu há ${-dias} dias`;
  if (dias === -1) return `${rotulo} venceu ontem`;
  if (dias === 0) return `${rotulo} vence hoje`;
  if (dias === 1) return `${rotulo} vence amanhã`;
  return `${rotulo} vence em ${dias} dias`;
}

export function ehDiaDeAvisar(dias: number): boolean {
  return (DIAS_DE_AVISAR as readonly number[]).includes(dias);
}
