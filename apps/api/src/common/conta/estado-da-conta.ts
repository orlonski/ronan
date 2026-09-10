/**
 * Em que pé a empresa está: pode entrar? pode escrever?
 *
 * São três estados, e a diferença entre os dois últimos é o que separa um teste
 * que vende de um teste que queima o cliente:
 *
 * - **operando** — o normal.
 * - **somente leitura** — entra, enxerga tudo, exporta, e não escreve. É onde um
 *   período de teste termina.
 * - **suspensa** — ninguém entra. O corte total, para inadimplência ou abuso.
 *
 * Função pura, sem Prisma nem Nest, porque é a regra que decide o acesso de uma
 * empresa inteira: precisa ser legível e testável sozinha.
 */

/** Códigos estáveis. Os apps escolhem a mensagem por eles, não pelo texto. */
export const CODIGO_CONTA_SUSPENSA = "CONTA_SUSPENSA";
export const CODIGO_CONTA_SOMENTE_LEITURA = "CONTA_SOMENTE_LEITURA";

export type ContaParaEstado = {
  ativa: boolean;
  somenteLeitura: boolean;
  trialExpiraEm: Date | null;
  motivoBloqueio: string | null;
};

export type EstadoConta = {
  /** Consegue autenticar e navegar. */
  podeEntrar: boolean;
  /** Consegue criar, editar e apagar. */
  podeEscrever: boolean;
  /** Está em período de teste (com ou sem dias restantes). */
  emTeste: boolean;
  /** Dias inteiros que faltam. Negativo = venceu. `null` = não é teste. */
  diasRestantes: number | null;
  /** O que dizer a quem esbarrar no bloqueio. */
  motivo: string | null;
  /** Código estável do bloqueio, ou `null` se não há. */
  codigo: string | null;
};

const DIA_MS = 86_400_000;

/**
 * Quantos dias inteiros faltam para a data — arredondando para cima, que é como
 * uma pessoa conta: se falta meio dia, ela diz "falta 1 dia", não "falta 0".
 */
export function diasAte(quando: Date, agora: Date = new Date()): number {
  return Math.ceil((quando.getTime() - agora.getTime()) / DIA_MS);
}

export function estadoDaConta(conta: ContaParaEstado, agora: Date = new Date()): EstadoConta {
  const diasRestantes = conta.trialExpiraEm ? diasAte(conta.trialExpiraEm, agora) : null;

  // A data vencida vale por si, sem esperar o cron da madrugada. Sem isto, a
  // empresa continuaria escrevendo até o próximo passe — e, pior, o resultado
  // dependeria de o cron ter rodado ou não.
  const trialVenceu = conta.trialExpiraEm !== null && conta.trialExpiraEm.getTime() <= agora.getTime();
  const somenteLeitura = conta.somenteLeitura || trialVenceu;

  if (!conta.ativa) {
    return {
      podeEntrar: false,
      podeEscrever: false,
      emTeste: conta.trialExpiraEm !== null,
      diasRestantes,
      motivo: conta.motivoBloqueio ?? "O acesso desta empresa está suspenso. Fale com a Movatruck.",
      codigo: CODIGO_CONTA_SUSPENSA,
    };
  }

  if (somenteLeitura) {
    return {
      podeEntrar: true,
      podeEscrever: false,
      emTeste: conta.trialExpiraEm !== null,
      diasRestantes,
      motivo:
        conta.motivoBloqueio ??
        (trialVenceu
          ? "Seu período de teste terminou. Você continua vendo e exportando tudo que já lançou."
          : "Esta empresa está em modo somente leitura."),
      codigo: CODIGO_CONTA_SOMENTE_LEITURA,
    };
  }

  return {
    podeEntrar: true,
    podeEscrever: true,
    emTeste: conta.trialExpiraEm !== null,
    diasRestantes,
    motivo: null,
    codigo: null,
  };
}
