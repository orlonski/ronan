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
  /**
   * `Conta.exigeFotoViagem` — a política é da TRANSPORTADORA, não da contraparte.
   * `false`/ausente quando não exige (o padrão).
   */
  contaExige?: boolean | null;
  /** `Material.temComprovanteFoto` — false = material que não gera papel. */
  materialTemComprovante?: boolean | null;
  /** `TipoServico.exigeTicket` — diária não tem ticket, logo não tem foto dele. */
  modoExigeTicket?: boolean;
};

/**
 * A transportadora exige a foto E existe comprovante pra fotografar?
 *
 * As duas supressões são deliberadas: cobrar foto de concreto (que não gera
 * ticket) ou de uma diária (que não tem romaneio) deixaria o motorista preso
 * pedindo foto de um papel que não existe.
 */
export function exigeFotoDaViagem(ctx: ContextoFotoViagem): boolean {
  if (ctx.contaExige !== true) return false;
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

// ===========================================================================
// Abastecimento: até três comprovantes, decididos pela MODALIDADE do motorista
// ===========================================================================

/** As flags da modalidade do motorista, ou null quando ele não tem uma. */
export type ModalidadeDoMotorista = {
  exigeFotoCupom: boolean;
  exigeFotoOdometro: boolean;
  exigeFotoBomba: boolean;
} | null;

export type FotosExigidas = {
  cupom: boolean;
  odometro: boolean;
  bomba: boolean;
};

/**
 * Quais fotos este abastecimento exige.
 *
 * Duas fontes, nesta ordem:
 *
 * 1. **Motorista COM modalidade** → as três flags vêm dela, inclusive o cupom.
 *    É o que torna possível "própria não pede foto de nada" mesmo com o
 *    interruptor geral da conta ligado.
 * 2. **Motorista SEM modalidade** → nada muda em relação a antes: vale só o
 *    cupom da conta, e odômetro/bomba nem existem pra ele.
 *
 * O ponto 2 é o que deixa a feature inerte: conta que não cadastrar modalidade
 * nenhuma, e motorista que ninguém classificou, seguem exatamente como hoje.
 */
export function resolverFotosExigidas(
  modalidade: ModalidadeDoMotorista,
  contaExigeCupom: boolean,
): FotosExigidas {
  if (modalidade) {
    return {
      cupom: modalidade.exigeFotoCupom === true,
      odometro: modalidade.exigeFotoOdometro === true,
      bomba: modalidade.exigeFotoBomba === true,
    };
  }
  return { cupom: contaExigeCupom === true, odometro: false, bomba: false };
}

/**
 * O motorista entregou tudo que foi exigido?
 *
 * Serve pra decidir se carimba `justificativaSemFoto` — e o que conta é a
 * COBERTURA do que se pediu, não a quantidade de fotos: mandar a bomba quando
 * se pediu o odômetro não resolve.
 */
export function fotosExigidasAtendidas(
  exigidas: FotosExigidas,
  tiposEnviados: readonly string[],
): boolean {
  const tem = (t: string) => tiposEnviados.includes(t);
  if (exigidas.cupom && !tem("CUPOM")) return false;
  if (exigidas.odometro && !tem("ODOMETRO")) return false;
  if (exigidas.bomba && !tem("BOMBA")) return false;
  return true;
}

/** true quando o abastecimento exige pelo menos uma foto. */
export function exigeAlgumaFoto(e: FotosExigidas): boolean {
  return e.cupom || e.odometro || e.bomba;
}
