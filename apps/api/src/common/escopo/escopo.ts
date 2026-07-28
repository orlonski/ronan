/**
 * Escopo de acesso de um usuário do painel: QUAIS registros ele enxerga.
 *
 * Dimensão independente do RBAC — o papel diz o que ele PODE FAZER
 * (`@RequerPermissao`), o escopo diz sobre QUAIS LINHAS. Um gestor de frota
 * terceira tem `viagens.ver` igual a um admin, mas só enxerga as viagens
 * carimbadas com a transportadora dele.
 *
 * `null` = acesso global (comportamento histórico, todo usuário da Schaba).
 */
export type EscopoAdmin = { transportadoraIds: string[] } | null;

/** Recursos que sabem se filtrar. Usado por `@EscopoPor` (ver escopo.decorator). */
export type RecursoEscopado =
  | "viagem"
  | "motorista"
  | "veiculo"
  | "pedagio"
  | "abastecimento";

/**
 * Fragmento de `where` do escopo, pros models que carregam o carimbo
 * (`Viagem`, `Pedagio`, `Abastecimento`) e pros cadastros (`Motorista`,
 * `Veiculo`) — todos têm a coluna `transportadoraId`.
 *
 * Restrito SEM vínculo nenhum devolve `in: []`, que o Prisma traduz pra zero
 * linhas. É o comportamento certo e não pode virar "sem filtro": fail-open aqui
 * entregaria a base inteira.
 */
/**
 * Sentinela pra model que NÃO tem `transportadoraId` (Empresa, Cliente,
 * Material, Local, Papel…). Não dá pra filtrar por frota, e quem protege é o
 * `EscopoGuard`, que barra o usuário restrito na porta.
 *
 * Existe pra `escopo` ser um parâmetro REQUERIDO em `paginate` sem virar
 * `undefined` silencioso: quem adiciona uma listagem nova tem que escolher
 * conscientemente entre filtrar e declarar que não há o que filtrar. O
 * `tsc` cobra — não há lint configurado no repo pra cobrar por nós.
 */
export const SEM_ESCOPO = Symbol("sem-escopo");

export type EscopoParaListagem = EscopoAdmin | typeof SEM_ESCOPO;

export function filtroEscopo(escopo: EscopoAdmin): { transportadoraId?: { in: string[] } } {
  if (!escopo) return {};
  return { transportadoraId: { in: escopo.transportadoraIds } };
}

/**
 * Combina o `where` do endpoint com o do escopo em `AND`.
 *
 * Nunca mesclar por spread: a listagem de viagens já usa `where.OR` pro filtro
 * de local, e dois `OR` no mesmo nível fazem um apagar o outro em silêncio —
 * ora perdendo o filtro, ora (pior) perdendo o escopo.
 */
export function comEscopo<T extends Record<string, unknown>>(
  base: T,
  escopo: EscopoAdmin,
): T | { AND: [T, { transportadoraId: { in: string[] } }] } {
  if (!escopo) return base;
  return { AND: [base, { transportadoraId: { in: escopo.transportadoraIds } }] };
}
