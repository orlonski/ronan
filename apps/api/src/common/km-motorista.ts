/**
 * O KM QUE O MOTORISTA INFORMA É LEI.
 *
 * Ele é quem estava na estrada, e quando muda o próprio km precisa justificar
 * (`responderKmDivergente`). Do lado do painel a regra é a mesma: o conferente
 * PODE corrigir — erro de digitação existe (640 em vez de 64) —, mas nunca
 * calado. Sem motivo escrito a alteração é recusada.
 *
 * `Viagem.kmMotorista` guarda o valor dele pra sempre; `Viagem.km` é o faturado,
 * o único que o painel pode mexer. Aqui mora só a decisão "essa alteração pode
 * passar?" — pura, pra ficar fácil de testar e impossível de divergir entre os
 * pontos que alteram km.
 */

/** Só o que a regra precisa saber da viagem (aceita Decimal do Prisma). */
export type ViagemParaAlteracaoKm = {
  km: { toString(): string } | number | null;
  kmMotorista: { toString(): string } | number | null;
};

/** Diferença abaixo disso é arredondamento de decimal, não alteração. */
const TOLERANCIA_KM = 0.001;

export type ChecagemKm =
  | { mudou: false }
  | { mudou: true; erro: string | null };

/**
 * Decide se a alteração de km pode entrar.
 *
 * - km ausente no input ou igual ao atual → `{ mudou: false }` (nada a checar).
 * - km diferente e a viagem tem km do motorista → exige motivo; sem ele devolve
 *   a mensagem de erro pronta (o caller lança 400).
 * - viagem sem km do motorista (nenhum lançamento do app por trás) → passa.
 */
export function checarAlteracaoKm(
  viagem: ViagemParaAlteracaoKm,
  kmNovo: number | null | undefined,
  motivo: string | null | undefined,
): ChecagemKm {
  if (kmNovo == null) return { mudou: false };
  const atual = paraNumero(viagem.km);
  if (atual != null && Math.abs(atual - kmNovo) < TOLERANCIA_KM) return { mudou: false };

  const doMotorista = paraNumero(viagem.kmMotorista);
  if (doMotorista == null) return { mudou: true, erro: null };
  if (motivo && motivo.trim().length > 0) return { mudou: true, erro: null };

  return {
    mudou: true,
    erro: `O km foi informado pelo motorista (${fmtKmBr(doMotorista)} km). Pra alterar, escreva o motivo.`,
  };
}

/** Km em pt-BR pras mensagens: "64", "64,5". */
export function fmtKmBr(km: number): string {
  if (!Number.isFinite(km)) return "?";
  const texto = Number.isInteger(km) ? String(km) : String(Number(km.toFixed(2)));
  return texto.replace(".", ",");
}

function paraNumero(v: { toString(): string } | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v.toString());
  return Number.isFinite(n) ? n : null;
}
