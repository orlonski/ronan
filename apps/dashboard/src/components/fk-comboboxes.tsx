"use client";

import { formatCpf, formatDocumento } from "@ronan/shared-types";
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

/**
 * Uma OBRA (model `Cliente`). O nome do cliente que paga só aparece embaixo
 * quando é diferente — "Castilho / Castilho" repetido não ajuda; já as duas
 * obras da Dromos precisam dizer de quem são. A lista de /admin/clientes traz
 * `empresa` junto; quem monta a opção sem ela só vê o nome.
 */
export const clienteOption = (c: {
  id: string;
  nome: string;
  empresa?: { nome: string } | null;
}): ComboboxOption => ({
  value: c.id,
  label: c.nome,
  sublabel:
    c.empresa && c.empresa.nome.trim().toLowerCase() !== c.nome.trim().toLowerCase()
      ? c.empresa.nome
      : undefined,
});

export const transportadoraOption = (t: {
  id: string;
  nome: string;
  cnpj?: string | null;
}): ComboboxOption => ({
  value: t.id,
  label: t.nome,
  sublabel: formatDocumento(t.cnpj) || undefined,
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

type Modalidade = { id: string; nome: string };

export const modalidadeOption = (m: Modalidade): ComboboxOption => ({
  value: m.id,
  label: m.nome,
});

/**
 * Vínculo do motorista (próprio / agregado / terceiro…). Só ativas — modalidade
 * desativada some do seletor mas não desclassifica quem já está nela.
 */
export function ModalidadeCombobox(props: SingleProps) {
  return (
    <AsyncCombobox<Modalidade>
      {...props}
      path="/admin/modalidades"
      filtros={{ ativo: "true" }}
      mapOption={modalidadeOption}
      searchPlaceholder="Buscar modalidade…"
      emptyMessage="Nenhuma modalidade cadastrada."
      placeholder={props.placeholder ?? "Sem modalidade"}
    />
  );
}

export function TransportadoraCombobox(props: SingleProps) {
  return (
    <AsyncCombobox<Transportadora>
      {...props}
      path="/admin/transportadoras"
      mapOption={transportadoraOption}
      searchPlaceholder="Buscar por nome ou CNPJ/CPF…"
      emptyMessage="Nenhuma transportadora encontrada."
      placeholder={props.placeholder ?? "Sem transportadora"}
    />
  );
}

export function TransportadoraComboboxMulti({
  value,
  onChange,
  initialOptions,
  placeholder = "Escolha as transportadoras…",
}: {
  value: string[];
  onChange: (values: string[]) => void;
  initialOptions?: ComboboxOption[];
  placeholder?: string;
}) {
  return (
    <AsyncComboboxMulti<Transportadora>
      value={value}
      onChange={onChange}
      initialOptions={initialOptions}
      path="/admin/transportadoras"
      mapOption={transportadoraOption}
      searchPlaceholder="Buscar por nome ou CNPJ/CPF…"
      emptyMessage="Nenhuma transportadora encontrada."
      placeholder={placeholder}
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
      emptyMessage="Nenhuma obra encontrada."
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
      emptyMessage="Nenhuma obra encontrada."
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
  triggerClassName,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  initialOption?: ComboboxOption;
  placeholder?: string;
  triggerClassName?: string;
}) {
  return (
    <AsyncCombobox<Motorista>
      triggerClassName={triggerClassName}
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

export function VeiculoComboboxMulti({
  value,
  onChange,
  placeholder = "Escolha os caminhões…",
}: {
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  return (
    <AsyncComboboxMulti<Veiculo>
      value={value}
      onChange={onChange}
      path="/admin/veiculos"
      mapOption={veiculoOption}
      searchPlaceholder="Buscar por placa…"
      emptyMessage="Nenhum veículo encontrado."
      placeholder={placeholder}
    />
  );
}

type Fornecedor = { id: string; nome: string; tipo?: string | null };
const fornecedorOption = (f: Fornecedor): ComboboxOption => ({ value: f.id, label: f.nome });

/** Oficina, borracharia, autopeças — quem faz o conserto (Fornecedor). */
export function FornecedorCombobox(props: SingleProps) {
  return (
    <AsyncCombobox<Fornecedor>
      {...props}
      path="/admin/fornecedores"
      mapOption={fornecedorOption}
      searchPlaceholder="Buscar oficina…"
      emptyMessage="Nenhuma oficina cadastrada."
      placeholder={props.placeholder ?? "Escolha a oficina"}
    />
  );
}
