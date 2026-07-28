import type { PaginationQuery, Paginated } from "./pagination.schema";
import { buildPaginationMeta } from "./pagination.schema";
import { SEM_ESCOPO, type EscopoParaListagem } from "../escopo/escopo";

/**
 * Delegate genérico do Prisma. Compatível com qualquer model (motorista, viagem, etc).
 * Mantemos o tipo solto pra evitar o tipo gigante específico de cada model.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaDelegate = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany: (args: any) => Promise<any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  count: (args: any) => Promise<number>;
};

type Path = string;

type SortableMap = Record<string, Path | { path: Path }>;

type SearchField = string | { path: string; mode?: "insensitive" | "default" };

export type PaginateOptions<TParams extends PaginationQuery> = {
  /** Params validados (page/pageSize/sort/order/q + filtros específicos do endpoint). */
  params: TParams;
  /**
   * Campos onde a busca global `q` é aplicada (OR contains insensitive).
   * Pode ser "nome" ou "motorista.nome" (nested via relação).
   */
  searchFields?: SearchField[];
  /**
   * Whitelist de campos ordenáveis. Cada chave é o nome aceito em `sort`,
   * e o valor é o path no orderBy do Prisma. Permite renomear (ex: "nome" → "motorista.nome").
   * Se valor é string, vira `{ [path]: order }`. Se for `{ path }`, mesmo.
   */
  sortable: SortableMap;
  /** Ordenação padrão quando `sort` não vem. */
  defaultSort?: { field: string; order?: "asc" | "desc" };
  /** `where` base do endpoint (filtros específicos já montados). */
  where?: Record<string, unknown>;
  /**
   * Escopo de acesso do usuário — REQUERIDO de propósito.
   *
   * `null` = acesso global, `{transportadoraIds}` = restrito, `SEM_ESCOPO` =
   * model sem coluna de frota. Não é opcional pra que uma listagem nova não
   * nasça vazando por omissão: o `tsc` quebra até alguém decidir.
   */
  escopo: EscopoParaListagem;
  /** Prisma `select` ou `include` (mutuamente exclusivos). */
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
};

/**
 * Helper genérico de paginação para listagens admin.
 * - Mescla `where` específico do endpoint com OR do `q` sobre `searchFields`
 * - Valida `sort` contra a whitelist `sortable`, com fallback `defaultSort`
 * - Executa findMany + count em paralelo
 * - Retorna `{ data, pagination }`
 */
export async function paginate<TRow, TParams extends PaginationQuery>(
  model: PrismaDelegate,
  options: PaginateOptions<TParams>,
): Promise<Paginated<TRow>> {
  const { params, where, escopo, searchFields, sortable, defaultSort, select, include } =
    options;

  const finalWhere = buildWhere(where, params.q, searchFields, escopo);
  const orderBy = buildOrderBy(params.sort, params.order, sortable, defaultSort);

  const findArgs: Record<string, unknown> = {
    where: finalWhere,
    orderBy,
    skip: (params.page - 1) * params.pageSize,
    take: params.pageSize,
  };
  if (select) findArgs.select = select;
  if (include) findArgs.include = include;

  const [data, total] = await Promise.all([
    model.findMany(findArgs) as Promise<TRow[]>,
    model.count({ where: finalWhere }),
  ]);

  return { data, pagination: buildPaginationMeta(total, params) };
}

function buildWhere(
  base: Record<string, unknown> | undefined,
  q: string | undefined,
  searchFields: SearchField[] | undefined,
  escopo: EscopoParaListagem,
): Record<string, unknown> | undefined {
  // Tudo entra em AND — nunca por spread. O `where` do endpoint e a busca
  // global podem trazer `OR` cada um (ex.: o filtro de local em viagens), e
  // dois `OR` no mesmo nível fazem um apagar o outro em silêncio.
  const partes: Record<string, unknown>[] = [];
  if (base && Object.keys(base).length > 0) partes.push(base);

  if (q && searchFields && searchFields.length > 0) {
    const OR = searchFields.map((field) => {
      const path = typeof field === "string" ? field : field.path;
      const mode = (typeof field === "object" && field.mode) || "insensitive";
      return setNested({}, path, { contains: q, mode });
    });
    partes.push({ OR });
  }

  // `in: []` (restrito sem vínculo) devolve zero linhas, que é o correto.
  if (escopo !== SEM_ESCOPO && escopo !== null) {
    partes.push({ transportadoraId: { in: escopo.transportadoraIds } });
  }

  if (partes.length === 0) return undefined;
  if (partes.length === 1) return partes[0];
  return { AND: partes };
}

function buildOrderBy(
  sort: string | undefined,
  order: "asc" | "desc",
  sortable: SortableMap,
  defaultSort?: { field: string; order?: "asc" | "desc" },
): Record<string, unknown> {
  const effectiveField = sort && sortable[sort] ? sort : defaultSort?.field;
  const effectiveOrder = sort && sortable[sort] ? order : defaultSort?.order ?? "asc";
  if (!effectiveField) return {};
  const entry = sortable[effectiveField];
  if (!entry) return {};
  const path = typeof entry === "string" ? entry : entry.path;
  return setNested({}, path, effectiveOrder);
}

/**
 * Constrói objeto aninhado a partir de path "a.b.c" → { a: { b: { c: value } } }.
 * Usado pra montar `where` e `orderBy` em relações do Prisma.
 */
function setNested(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split(".");
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return target;
}
