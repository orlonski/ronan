/**
 * O mínimo que a regra precisa saber de uma empresa. Genérico de propósito:
 * quem chama passa a conta inteira que já carregou (com estado, logo, o que
 * for) e recebe ela de volta, sem a função ter que conhecer esses campos.
 */
export type ContaBasica = { id: string; nome: string; ativa: boolean };

/** O que o `JwtStrategy` sabe do usuário na hora de decidir a conta. */
export type UsuarioParaConta<C extends ContaBasica = ContaBasica> = {
  /** A empresa dele, a que não muda. */
  contaId: string;
  conta: C;
  plataforma: boolean;
  /** A empresa que ele pediu pra visitar, se pediu. */
  contaAtiva: C | null;
};

export type ContaEfetiva<C extends ContaBasica = ContaBasica> = {
  conta: C;
  assumida: boolean;
};

/**
 * Qual empresa manda nesta requisição.
 *
 * Função pura de propósito: é a regra que decide o isolamento entre empresas, e
 * ela precisa ser legível e testável sem subir Nest, Passport ou banco.
 *
 * Toda queda leva pra casa dele em silêncio, sem erro — quem perde o direito de
 * visitar não fica preso numa tela quebrada, volta a ver a própria empresa:
 *
 * - `plataforma` revogado desde que ele entrou;
 * - empresa visitada desativada ou apagada (a FK é `ON DELETE SET NULL`);
 * - visitada igual à de origem, que é o mesmo que estar em casa.
 *
 * Como nada disso vive no token, a queda vale já na requisição seguinte.
 */
export function resolverContaEfetiva<C extends ContaBasica>(
  u: UsuarioParaConta<C>,
): ContaEfetiva<C> {
  const visitando =
    u.plataforma && u.contaAtiva !== null && u.contaAtiva.ativa && u.contaAtiva.id !== u.contaId;

  return visitando ? { conta: u.contaAtiva!, assumida: true } : { conta: u.conta, assumida: false };
}
