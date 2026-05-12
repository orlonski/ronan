import { z } from "zod";

export const PAGE_SIZE_DEFAULT = 10;
/**
 * 500 acomoda tanto admins que abrem pageSize=100 quanto `useResourceOptions`
 * carregando opções de FK (motoristas/empresas/obras) num único request.
 */
export const PAGE_SIZE_MAX = 500;

/**
 * Schema base de paginação aplicado a listagens administrativas.
 * Endpoints específicos estendem com `.extend({...})` adicionando seus filtros.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  sort: z.string().min(1).optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
  q: z.string().trim().min(1).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type Paginated<T> = {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export function buildPaginationMeta(
  total: number,
  params: Pick<PaginationQuery, "page" | "pageSize">,
): Paginated<unknown>["pagination"] {
  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
