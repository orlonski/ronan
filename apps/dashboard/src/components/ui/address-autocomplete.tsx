"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { Input } from "./input";

export type SugestaoLista = {
  fonte: "GOOGLE";
  placeId: string;
  nome: string;
  textoCompleto: string;
};

export type SugestaoEndereco = {
  fonte: "VIACEP" | "GOOGLE";
  placeId?: string;
  textoCompleto?: string;
  nome?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
  lat?: number;
  lng?: number;
};

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Digite endereço, rua, ou nome do lugar...",
  required,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: SugestaoEndereco) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const token = useAuthToken();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolvendo, setResolvendo] = useState(false);
  const [sugs, setSugs] = useState<SugestaoLista[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function buscar(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!token) return;
      if (q.trim().length < 3) {
        setSugs([]);
        return;
      }
      setLoading(true);
      try {
        const data = await fetchApi<SugestaoLista[]>(
          `/geocoding/buscar?q=${encodeURIComponent(q)}`,
          { token },
        );
        setSugs(data);
        setOpen(data.length > 0);
      } catch {
        setSugs([]);
      } finally {
        setLoading(false);
      }
    }, 600);
  }

  async function escolher(s: SugestaoLista) {
    if (!token) return;
    setOpen(false);
    setResolvendo(true);
    try {
      const detalhe = await fetchApi<SugestaoEndereco | null>(
        `/geocoding/place?placeId=${encodeURIComponent(s.placeId)}`,
        { token },
      );
      if (detalhe) {
        onSelect(detalhe);
        onChange(detalhe.logradouro ?? detalhe.nome ?? detalhe.textoCompleto ?? value);
      }
    } catch {
      /* silencioso — usuário pode digitar manual */
    } finally {
      setResolvendo(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            buscar(e.target.value);
          }}
          onFocus={() => sugs.length > 0 && setOpen(true)}
          placeholder={placeholder}
          required={required}
          disabled={disabled || resolvendo}
          className="pl-9"
          autoComplete="off"
        />
        {(loading || resolvendo) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {resolvendo ? "carregando endereço..." : "buscando..."}
          </div>
        )}
      </div>

      {open && sugs.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-background shadow-lg">
          {sugs.map((s) => (
            <button
              key={s.placeId}
              type="button"
              onClick={() => escolher(s)}
              className="flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted"
            >
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">{s.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{s.textoCompleto}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
