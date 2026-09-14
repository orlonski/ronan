"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Column } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

/**
 * Header de coluna ordenável. Uso típico em `columns`:
 *   header: ({ column }) => <DataTableColumnHeader column={column} title="Nome" />
 */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
}) {
  const canSort = column.getCanSort();
  if (!canSort) return <span className={className}>{title}</span>;

  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      aria-label={
        sorted === "asc"
          ? `${title}: ordenado crescente. Clique pra inverter.`
          : sorted === "desc"
            ? `${title}: ordenado decrescente. Clique pra inverter.`
            : `Ordenar por ${title}`
      }
      className={cn(
        "-mx-1 flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted",
        className,
      )}
    >
      <span>{title}</span>
      {sorted === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
      ) : sorted === "desc" ? (
        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-40" aria-hidden />
      )}
    </button>
  );
}
