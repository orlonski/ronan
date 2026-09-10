/** O que o `JwtStrategy` sabe do usuário na hora de decidir a conta. */
export type UsuarioParaConta = {
  /** A empresa dele, a que não muda. */
  contaId: string;
  conta: { id: string; nome: string };
  plataforma: boolean;
  /** A empresa que ele pediu pra visitar, se pediu. */
  contaAtiva: { id: string; nome: string; ativa: boolean } | null;
};

export type ContaEfetiva = {
  conta: { id: string; nome: string };
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
export function resolverContaEfetiva(u: UsuarioParaConta): ContaEfetiva {
  const visitando =
    u.plataforma && u.contaAtiva !== null && u.contaAtiva.ativa && u.contaAtiva.id !== u.contaId;

  return visitando
    ? { conta: { id: u.contaAtiva!.id, nome: u.contaAtiva!.nome }, assumida: true }
    : { conta: u.conta, assumida: false };
}
