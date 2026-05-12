"use client";

import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { LoadingInline } from "@/components/loading";
import type { DataTableState } from "@/hooks/use-data-table-state";
import type { Pagination } from "@/lib/client-api";
import { DataTablePagination } from "./data-table-pagination";

export type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  pagination: Pagination | undefined;
  state: DataTableState;
  isLoading?: boolean;
  isFetching?: boolean;
  /** Conteúdo extra acima da tabela (toolbar com busca/filtros). */
  toolbar?: React.ReactNode;
  /** Versão mobile alternativa: cards renderizados pra cada linha. Se ausente, mostra a tabela em qualquer breakpoint. */
  renderMobileCard?: (row: T) => React.ReactNode;
  emptyMessage?: string;
};

export function DataTable<T>({
  columns,
  data,
  pagination,
  state,
  isLoading,
  isFetching,
  toolbar,
  renderMobileCard,
  emptyMessage = "Nenhum registro encontrado.",
}: DataTableProps<T>) {
  const sorting: SortingState = React.useMemo(
    () => (state.sort ? [{ id: state.sort, desc: state.order === "desc" }] : []),
    [state.sort, state.order],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    pageCount: pagination?.totalPages ?? 1,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (!first) {
        state.setSort(undefined, "asc");
      } else {
        state.setSort(first.id, first.desc ? "desc" : "asc");
      }
    },
  });

  const colCount = columns.length;
  const showEmpty = !isLoading && data.length === 0;

  return (
    <div className="space-y-3">
      {toolbar}

      {/* Mobile (renderMobileCard opcional) */}
      {renderMobileCard && (
        <div className="space-y-3 md:hidden">
          {isLoading && <Card className="p-6"><LoadingInline /></Card>}
          {showEmpty && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </Card>
          )}
          {data.map((row, idx) => (
            <React.Fragment key={getRowKey(row, idx)}>{renderMobileCard(row)}</React.Fragment>
          ))}
        </div>
      )}

      <Card className={renderMobileCard ? "hidden md:block" : undefined}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={
                      header.column.columnDef.size
                        ? { width: `${header.column.columnDef.size}px` }
                        : undefined
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={colCount}>
                  <LoadingInline />
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {showEmpty && (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {pagination && (
        <DataTablePagination
          pagination={pagination}
          state={state}
          isFetching={isFetching}
        />
      )}
    </div>
  );
}

function getRowKey(row: unknown, idx: number): string {
  if (row && typeof row === "object" && "id" in row) {
    const id = (row as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  return String(idx);
}
