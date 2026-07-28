"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

/**
 * Combobox searchable multi-select. Trigger mostra chips dos selecionados com
 * X individual; popover lista com checkboxes (não fecha ao clicar). Pareado
 * com o Combobox single em estilo.
 */
export function ComboboxMulti({
  value,
  onChange,
  options,
  placeholder = "Selecione…",
  searchPlaceholder = "Buscar…",
  emptyMessage = "Nada encontrado.",
  loading = false,
  className,
  triggerClassName,
  serverSide = false,
  onSearchChange,
}: {
  value: string[];
  onChange: (values: string[]) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Busca no servidor: não filtra client-side e emite o termo digitado. */
  serverSide?: boolean;
  onSearchChange?: (termo: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const selecionados = useMemo(() => {
    const map = new Map(options.map((o) => [o.value, o]));
    return value
      .map((v) => map.get(v))
      .filter((o): o is ComboboxOption => !!o);
  }, [options, value]);

  const filtrados = useMemo(() => {
    if (serverSide) return options;
    if (!busca.trim()) return options;
    const termo = busca.toLowerCase().trim();
    return options.filter((o) => {
      if (o.label.toLowerCase().includes(termo)) return true;
      if (o.sublabel?.toLowerCase().includes(termo)) return true;
      return false;
    });
  }, [options, busca, serverSide]);

  function toggle(v: string) {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  function removeChip(v: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(value.filter((x) => x !== v));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Acrescenta, não substitui (mesma armadilha do Combobox single:
          // passar só "w-full" apagava borda/padding e soltava o trigger).
          className={cn(
            "flex min-h-10 w-full items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5 text-left text-sm shadow-sm hover:bg-accent/30",
            triggerClassName,
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {selecionados.length === 0 ? (
              <span className="px-1 text-muted-foreground">{placeholder}</span>
            ) : (
              selecionados.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
                >
                  {o.label}
                  <X
                    className="h-3 w-3 text-muted-foreground hover:text-foreground"
                    onClick={(e) => removeChip(o.value, e)}
                  />
                </span>
              ))
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={className ?? "w-[320px] p-0"} align="start">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                onSearchChange?.(e.target.value);
              }}
              placeholder={searchPlaceholder}
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1">
          {loading && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Carregando…
            </p>
          )}
          {!loading && filtrados.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          )}
          {filtrados.map((o) => {
            const ativo = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent/30 ${
                  ativo ? "bg-accent/40" : ""
                }`}
              >
                <Check
                  className={`h-4 w-4 shrink-0 ${ativo ? "text-primary" : "opacity-0"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{o.label}</p>
                  {o.sublabel && (
                    <p className="text-xs text-muted-foreground">{o.sublabel}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
