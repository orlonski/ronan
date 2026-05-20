"use client";

import { useMemo } from "react";
import { formatCpf } from "@ronan/shared-types";
import { useResourceOptions } from "@/lib/client-api";
import { Combobox } from "@/components/ui/combobox";

type Motorista = { id: string; nome: string; cpf: string };

/**
 * Wrapper do Combobox específico pra motoristas: carrega via /admin/motoristas
 * e formata CPF como sublabel.
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
  const motoristasOpts = useResourceOptions<Motorista>("/admin/motoristas", {
    pageSize: 500,
  });

  const options = useMemo(
    () =>
      (motoristasOpts.data ?? []).map((m) => ({
        value: m.id,
        label: m.nome,
        sublabel: formatCpf(m.cpf),
      })),
    [motoristasOpts.data],
  );

  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="Buscar por nome ou CPF…"
      emptyMessage="Nenhum motorista encontrado."
      loading={motoristasOpts.isLoading}
      className="w-[320px] p-0"
      triggerClassName="flex h-10 min-w-[220px] items-center justify-between gap-2 rounded-md border bg-background px-3 text-left text-sm shadow-sm hover:bg-accent/30"
    />
  );
}
