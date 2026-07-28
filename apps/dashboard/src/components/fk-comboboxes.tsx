"use client";

import { formatCpf } from "@ronan/shared-types";
import {
  AsyncCombobox,
  AsyncComboboxMulti,
} from "@/components/ui/async-combobox";
import type { ComboboxOption } from "@/components/ui/combobox";

/**
 * Comboboxes de FK com autocomplete server-side, um por entidade. Cada um só
 * fixa o endpoint e como montar o label/sublabel — a busca (sem teto de 200)
 * vive no AsyncCombobox. Use `initialOption(s)` nos forms de edição pra o
 * item já selecionado aparecer no trigger antes de buscar.
 */

type Local = { id: string; nome: string; cidade: string; uf: string };
type Veiculo = { id: string; placa: string; modelo: string | null };
type Cliente = { id: string; nome: string };
type Motorista = { id: string; nome: string; cpf: string };
type Transportadora = { id: string; nome: string; cnpj: string | null };

export const localOption = (l: {
  id: string;
  nome: string;
  cidade: string;
  uf: string;
}): ComboboxOption => ({
  value: l.id,
  label: l.nome,
  sublabel: `${l.cidade}/${l.uf}`,
});

export const veiculoOption = (v: {
  id: string;
  placa: string;
  modelo?: string | null;
}): ComboboxOption => ({
  value: v.id,
  label: v.placa,
  sublabel: v.modelo ?? undefined,
});

export const clienteOption = (c: {
  id: string;
  nome: string;
}): ComboboxOption => ({ value: c.id, label: c.nome });

export const transportadoraOption = (t: {
  id: string;
  nome: string;
  cnpj?: string | null;
}): ComboboxOption => ({
  value: t.id,
  label: t.nome,
  sublabel: t.cnpj ?? undefined,
});

type SingleProps = {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  initialOption?: ComboboxOption;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
};

export function LocalCombobox(props: SingleProps) {
  return (
    <AsyncCombobox<Local>
      {...props}
      path="/admin/locais"
      mapOption={localOption}
      searchPlaceholder="Buscar por nome, cidade, endereço…"
      emptyMessage="Nenhum local encontrado."
      placeholder={props.placeholder ?? "Selecione"}
    />
  );
}

export function VeiculoCombobox(props: SingleProps) {
  return (
    <AsyncCombobox<Veiculo>
      {...props}
      path="/admin/veiculos"
      mapOption={veiculoOption}
      searchPlaceholder="Buscar por placa…"
      emptyMessage="Nenhum veículo encontrado."
      placeholder={props.placeholder ?? "Selecione"}
    />
  );
}

export function TransportadoraCombobox(props: SingleProps) {
  return (
    <AsyncCombobox<Transportadora>
      {...props}
      path="/admin/transportadoras"
      mapOption={transportadoraOption}
      searchPlaceholder="Buscar por nome ou CNPJ…"
      emptyMessage="Nenhuma transportadora encontrada."
      placeholder={props.placeholder ?? "Sem transportadora"}
    />
  );
}

export function ClienteCombobox(props: SingleProps) {
  return (
    <AsyncCombobox<Cliente>
      {...props}
      path="/admin/clientes"
      mapOption={clienteOption}
      searchPlaceholder="Buscar por nome…"
      emptyMessage="Nenhum cliente encontrado."
      placeholder={props.placeholder ?? "Selecione"}
    />
  );
}

export function ClienteComboboxMulti({
  value,
  onChange,
  initialOptions,
  placeholder,
}: {
  value: string[];
  onChange: (values: string[]) => void;
  initialOptions?: ComboboxOption[];
  placeholder?: string;
}) {
  return (
    <AsyncComboboxMulti<Cliente>
      value={value}
      onChange={onChange}
      initialOptions={initialOptions}
      path="/admin/clientes"
      mapOption={clienteOption}
      searchPlaceholder="Buscar por nome…"
      emptyMessage="Nenhum cliente encontrado."
      placeholder={placeholder ?? "Selecione…"}
    />
  );
}

const motoristaOption = (m: Motorista): ComboboxOption => ({
  value: m.id,
  label: m.nome,
  sublabel: formatCpf(m.cpf),
});

export function MotoristaCombobox({
  value,
  onChange,
  initialOption,
  placeholder = "Filtrar por motorista…",
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  initialOption?: ComboboxOption;
  placeholder?: string;
}) {
  return (
    <AsyncCombobox<Motorista>
      value={value}
      onChange={onChange}
      initialOption={initialOption}
      path="/admin/motoristas"
      mapOption={motoristaOption}
      placeholder={placeholder}
      searchPlaceholder="Buscar por nome ou CPF…"
      emptyMessage="Nenhum motorista encontrado."
    />
  );
}

export function MotoristaComboboxMulti({
  value,
  onChange,
  initialOptions,
  placeholder = "Buscar por nome ou CPF…",
}: {
  value: string[];
  onChange: (values: string[]) => void;
  initialOptions?: ComboboxOption[];
  placeholder?: string;
}) {
  return (
    <AsyncComboboxMulti<Motorista>
      value={value}
      onChange={onChange}
      initialOptions={initialOptions}
      path="/admin/motoristas"
      mapOption={motoristaOption}
      searchPlaceholder="Buscar por nome ou CPF…"
      emptyMessage="Nenhum motorista encontrado."
      placeholder={placeholder}
    />
  );
}
