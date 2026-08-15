/**
 * Quem decide se um lançamento precisa da FOTO do comprovante.
 *
 * Mesma natureza de `common/tipo-servico.ts`: o app é só UI — ele bloqueia o
 * botão de salvar, mas a palavra final é daqui.
 *
 * ⚠️ A diferença crucial em relação às outras exigências (peso, ticket, km):
 * este arquivo NUNCA lança exceção. Foto não é dado que o motorista digita —
 * é um arquivo que pode ter sido purgado pelo SO entre a captura e o envio
 * (ver o `fotoAindaExiste` em apps/motorista-app/lib/sync.ts). Recusar com 4xx
 * transformaria "perdi a foto" em "perdi a viagem": o item morre no outbox
 * depois de MAX_ATTEMPTS, dias depois, com o motorista longe. Recusar também
 * derrubaria todo lançamento de app que ainda não pegou o OTA.
 *
 * Então: o bloqueio mora no app, e aqui a gente CARIMBA a falta pro painel
 * cobrar — o fluxo de cobrança (TipoDivergencia.FOTO_ILEGIVEL + card no app +
 * responderFotoDivergente) já existe e é maduro.
 */

/** Motivo carimbado quando ninguém explicou a ausência da foto. */
export const SEM_JUSTIFICATIVA =
  "Lançada sem foto e sem justificativa (app desatualizado ou foto perdida no aparelho).";

export type ContextoFotoViagem = {
  /** `false`/ausente quando a empresa não exige (o padrão). */
  empresaExige?: boolean | null;
  /** `Material.temComprovanteFoto` — false = material que não gera papel. */
  materialTemComprovante?: boolean | null;
  /** `TipoServico.exigeTicket` — diária não tem ticket, logo não tem foto dele. */
  modoExigeTicket?: boolean;
};

/**
 * A empresa exige a foto E existe comprovante pra fotografar?
 *
 * As duas supressões são deliberadas: cobrar foto de concreto (que não gera
 * ticket) ou de uma diária (que não tem romaneio) deixaria o motorista preso
 * pedindo foto de um papel que não existe.
 */
export function exigeFotoDaViagem(ctx: ContextoFotoViagem): boolean {
  if (ctx.empresaExige !== true) return false;
  if (ctx.materialTemComprovante === false) return false;
  if (ctx.modoExigeTicket === false) return false;
  return true;
}

/**
 * O que gravar em `justificativaSemFoto`.
 *
 * - Tem foto → null (não há falta a explicar).
 * - Não exige → null (mesmo sem foto: é o comportamento de sempre).
 * - Exige e o motorista explicou → o texto dele.
 * - Exige e ninguém explicou → o carimbo automático, pro painel cobrar.
 */
export function resolverJustificativaSemFoto(
  exige: boolean,
  temFoto: boolean,
  justificativaDoMotorista?: string | null,
): string | null {
  if (temFoto) return null;
  if (!exige) return null;
  const texto = justificativaDoMotorista?.trim();
  return texto || SEM_JUSTIFICATIVA;
}
