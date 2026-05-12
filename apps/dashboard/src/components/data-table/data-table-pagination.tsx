"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { DataTableState } from "@/hooks/use-data-table-state";
import type { Pagination } from "@/lib/client-api";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function DataTablePagination({
  pagination,
  state,
  isFetching,
}: {
  pagination: Pagination;
  state: DataTableState;
  isFetching?: boolean;
}) {
  const { page, pageSize, total, totalPages } = pagination;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3 px-2 py-1 text-sm md:flex-row md:items-center md:justify-between">
      <div className="text-muted-foreground">
        {total === 0 ? (
          "Nenhum registro"
        ) : (
          <>
            Mostrando <span className="font-medium text-foreground">{start}–{end}</span> de{" "}
            <span className="font-medium text-foreground">{total}</span>
            {isFetching && <span className="ml-2 text-xs italic">atualizando…</span>}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Por página</span>
          <Select
            value={pageSize}
            onChange={(e) => state.setPageSize(Number(e.target.value))}
            className="h-8 w-[78px]"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => state.setPage(1)}
            disabled={page <= 1}
            title="Primeira página"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => state.setPage(page - 1)}
            disabled={page <= 1}
            title="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 text-muted-foreground">
            Página <span className="font-medium text-foreground">{page}</span> de{" "}
            <span className="font-medium text-foreground">{totalPages}</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => state.setPage(page + 1)}
            disabled={page >= totalPages}
            title="Próxima"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => state.setPage(totalPages)}
            disabled={page >= totalPages}
            title="Última página"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
