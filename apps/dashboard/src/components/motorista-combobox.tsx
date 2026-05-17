"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { formatCpf } from "@ronan/shared-types";
import { useResourceOptions } from "@/lib/client-api";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Motorista = { id: string; nome: string; cpf: string };

/**
 * Combobox searchable de motoristas. Carrega todos via /admin/motoristas
 * (pageSize 500) e filtra client-side por nome ou CPF. Suficiente pro
 * volume atual da operação; pra muitos mais, virar autocomplete server-side.
 */
export function MotoristaCombobox({
  value,
  onChange,
  placeholder = "Filtrar por motorista…",
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const motoristasOpts = useResourceOptions<Motorista>("/admin/motoristas", {
    pageSize: 500,
  });

  const todos = motoristasOpts.data ?? [];
  const selecionado = todos.find((m) => m.id === value);

  const filtrados = useMemo(() => {
    if (!busca.trim()) return todos;
    const termo = busca.toLowerCase().trim();
    const termoNum = termo.replace(/\D/g, "");
    return todos.filter((m) => {
      if (m.nome.toLowerCase().includes(termo)) return true;
      if (termoNum && m.cpf.includes(termoNum)) return true;
      return false;
    });
  }, [todos, busca]);

  function selecionar(id: string | undefined) {
    onChange(id);
    setOpen(false);
    setBusca("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 min-w-[220px] items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-sm hover:bg-accent/30"
        >
          <span className="truncate">
            {selecionado ? (
              <>
                <span className="font-medium">{selecionado.nome}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {formatCpf(selecionado.cpf)}
                </span>
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
      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou CPF…"
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1">
          {motoristasOpts.isLoading && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Carregando…
            </p>
          )}
          {!motoristasOpts.isLoading && filtrados.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Nenhum motorista encontrado.
            </p>
          )}
          {filtrados.map((m) => {
            const ativo = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selecionar(m.id)}
                className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent/30 ${
                  ativo ? "bg-accent/40" : ""
                }`}
              >
                <Check
                  className={`h-4 w-4 shrink-0 ${ativo ? "text-primary" : "opacity-0"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.nome}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {formatCpf(m.cpf)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
