/**
 * Checklist do caminhão — as regras que não dependem de banco.
 * Lembrado, nunca obrigatório (ver shared-types/src/checklist.ts).
 */

/** Dia civil de Brasília (AAAA-MM-DD) de um instante. */
export function diaBR(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Caminhões que rodaram no dia sem checklist naquele dia.
 *
 * "Rodou" = viagem iniciada (ou com data) no dia. O checklist vale pro
 * caminhão no dia inteiro, feito por qualquer motorista — caminhão de dois
 * turnos não precisa de dois.
 */
export function caminhoesSemChecklist(
  viagens: { veiculoId: string; placa: string; motorista: string; quando: Date }[],
  checklists: { veiculoId: string | null; feitoEm: Date }[],
): { veiculoId: string; placa: string; dia: string; motoristas: string[] }[] {
  const feitos = new Set(checklists.filter((c) => c.veiculoId).map((c) => `${c.veiculoId}|${diaBR(c.feitoEm)}`));
  const faltando = new Map<string, { veiculoId: string; placa: string; dia: string; motoristas: Set<string> }>();
  for (const v of viagens) {
    const dia = diaBR(v.quando);
    const k = `${v.veiculoId}|${dia}`;
    if (feitos.has(k)) continue;
    const atual = faltando.get(k) ?? { veiculoId: v.veiculoId, placa: v.placa, dia, motoristas: new Set<string>() };
    atual.motoristas.add(v.motorista);
    faltando.set(k, atual);
  }
  return [...faltando.values()]
    .map((f) => ({ ...f, motoristas: [...f.motoristas].sort() }))
    .sort((a, b) => b.dia.localeCompare(a.dia) || a.placa.localeCompare(b.placa));
}

/** Texto do aviso de problema que um item reprovado abre. */
export function descricaoDoAviso(item: string, observacao: string | null | undefined): string {
  const obs = observacao?.trim();
  return `Checklist: ${item}${obs ? ` — ${obs}` : ""}`.slice(0, 1000);
}
