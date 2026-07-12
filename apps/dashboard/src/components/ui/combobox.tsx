"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Texto secundário pequeno (ex: CPF, cidade, contagem). Opcional. */
  sublabel?: string;
};

/**
 * Combobox searchable genérico: trigger com X pra limpar, popover com input
 * de busca + lista. Filtra client-side por label/sublabel. Usado em todos os
 * filtros do dashboard (FK ou enum).
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Todos",
  searchPlaceholder = "Buscar…",
  emptyMessage = "Nada encontrado.",
  loading = false,
  className,
  triggerClassName,
  showSearch = true,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  className?: string;
  triggerClassName?: string;
  /** Esconde input de busca quando lista tem poucas opções fixas. Default true. */
  showSearch?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const selecionado = options.find((o) => o.value === value);

  const filtrados = useMemo(() => {
    if (!busca.trim() || !showSearch) return options;
    const termo = busca.toLowerCase().trim();
    return options.filter((o) => {
      if (o.label.toLowerCase().includes(termo)) return true;
      if (o.sublabel?.toLowerCase().includes(termo)) return true;
      return false;
    });
  }, [options, busca, showSearch]);

  function selecionar(v: string | undefined) {
    onChange(v);
    setOpen(false);
    setBusca("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={
            triggerClassName ??
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-sm hover:bg-accent/30 sm:w-auto sm:min-w-[180px]"
          }
        >
          <span className="truncate">
            {selecionado ? (
              <>
                <span className="font-medium">{selecionado.label}</span>
                {selecionado.sublabel && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {selecionado.sublabel}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {selecionado && (
              <X
                className="h-4 w-4 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  selecionar(undefined);
                }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className={className ?? "w-[280px] p-0"} align="start">
        {showSearch && (
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 pl-8"
              />
            </div>
          </div>
        )}
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
            const ativo = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => selecionar(o.value)}
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
