"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AddressAutocomplete, type SugestaoEndereco } from "@/components/ui/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClienteComboboxMulti } from "@/components/fk-comboboxes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TagInput } from "@/components/ui/tag-input";
import { FotoLocal } from "@/components/foto-local";

const PontoMap = dynamic(
  () => import("@/components/ponto-map").then((m) => m.PontoMap),
  { ssr: false, loading: () => <div className="h-64 rounded-lg border bg-muted/30" /> },
);
import {
  fetchApi,
  useAuthToken,
  useCreateResource,
  useUpdateResource,
} from "@/lib/client-api";

type Tipo = "CARGA" | "DESCARGA" | "AMBOS";
type Cliente = { id: string; nome: string };

export type Local = {
  id: string;
  nome: string;
  logradouro: string;
  numero: string | null;
  bairro: string | null;
  cidade: string;
  uf: string;
  cep: string | null;
  pontoReferencia: string | null;
  tipo: Tipo;
  ativo: boolean;
  clientes: Cliente[];
  lat: number | null;
  lng: number | null;
  apelidos: string[];
  totalViagens?: number;
};

type ViaCepRes = {
  fonte: "VIACEP";
  logradouro?: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
};

const PATH = "/admin/locais";

type Props = { initial?: Local };

export function LocalForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<Record<string, unknown>, Local>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Local>(PATH, PATH);
  const token = useAuthToken();

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    logradouro: initial?.logradouro ?? "",
    numero: initial?.numero ?? "",
    bairro: initial?.bairro ?? "",
    cidade: initial?.cidade ?? "",
    uf: initial?.uf ?? "PR",
    cep: initial?.cep ?? "",
    pontoReferencia: initial?.pontoReferencia ?? "",
    tipo: (initial?.tipo ?? "AMBOS") as Tipo,
    clienteIds: initial?.clientes?.map((c) => c.id) ?? ([] as string[]),
    lat: initial?.lat ?? (null as number | null),
    lng: initial?.lng ?? (null as number | null),
    apelidos: initial?.apelidos ?? [],
  });
  const [cepLoading, setCepLoading] = useState(false);
  const [cepNotFound, setCepNotFound] = useState(false);

  function aplicarSugestao(s: SugestaoEndereco) {
    setForm((f) => ({
      ...f,
      nome: f.nome || s.nome || "",
      logradouro: s.logradouro ?? s.nome ?? f.logradouro,
      numero: s.numero ?? f.numero,
      bairro: s.bairro ?? f.bairro,
      cidade: s.cidade || f.cidade,
      uf: s.uf || f.uf,
      cep: s.cep ?? f.cep,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
    }));
  }

  async function consultarCep(cepRaw: string) {
    const cep = cepRaw.replace(/\D/g, "");
    if (cep.length !== 8 || !token) return;
    setCepLoading(true);
    setCepNotFound(false);
    try {
      const res = await fetchApi<ViaCepRes | null>(`/geocoding/cep?cep=${cep}`, { token });
      if (res) {
        setForm((f) => ({
          ...f,
          logradouro: res.logradouro ?? f.logradouro,
          bairro: res.bairro ?? f.bairro,
          cidade: res.cidade,
          uf: res.uf,
          cep: res.cep ?? cep,
        }));
      } else {
        setCepNotFound(true);
      }
    } finally {
      setCepLoading(false);
    }
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const body: Record<string, unknown> = {
      nome: form.nome,
      logradouro: form.logradouro,
      cidade: form.cidade,
      uf: form.uf,
      tipo: form.tipo,
      numero: form.numero || undefined,
      bairro: form.bairro || undefined,
      cep: form.cep ? form.cep.replace(/\D/g, "") : undefined,
      pontoReferencia: form.pontoReferencia || undefined,
      clienteIds: form.clienteIds,
      lat: form.lat ?? undefined,
      lng: form.lng ?? undefined,
      apelidos: form.apelidos,
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(body);
    }
    router.push("/locais");
  }

  const saving = create.isPending || update.isPending;
  const temCoord = form.lat != null && form.lng != null;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className={temCoord ? "grid grid-cols-1 gap-6 lg:grid-cols-2" : ""}>
        <Card className="space-y-4 p-6">
          <div className="space-y-2">
            <Label>Buscar endereço</Label>
            <AddressAutocomplete
              value={form.logradouro}
              onChange={(v) => setForm((f) => ({ ...f, logradouro: v }))}
              onSelect={aplicarSugestao}
            />
            <p className="text-xs text-muted-foreground">
              Busque por nome do lugar, rua ou bairro — ou cole as coordenadas
              (ex.: <span className="font-mono">-25.4284, -49.2733</span>) pra puxar o
              endereço. Os campos abaixo são preenchidos automaticamente.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Nome do local *</Label>
            <Input
              required
              placeholder='ex: "Pedreira Souza Naves — balança 2"'
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Use um nome específico (não só rua) — ajuda na conferência com o motorista.
            </p>
          </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>CEP</Label>
            <Input
              value={form.cep}
              maxLength={9}
              placeholder="00000-000"
              onChange={(e) => setForm({ ...form, cep: e.target.value })}
              onBlur={(e) => consultarCep(e.target.value)}
            />
            {cepLoading && <p className="text-xs text-muted-foreground">Consultando...</p>}
            {cepNotFound && (
              <p className="text-xs text-amber-600">CEP não encontrado, preencha manual.</p>
            )}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Logradouro *</Label>
            <Input
              required
              value={form.logradouro}
              onChange={(e) => setForm({ ...form, logradouro: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Número</Label>
            <Input
              value={form.numero}
              onChange={(e) => setForm({ ...form, numero: e.target.value })}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Bairro</Label>
            <Input
              value={form.bairro}
              onChange={(e) => setForm({ ...form, bairro: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <Label>Cidade *</Label>
            <Input
              required
              value={form.cidade}
              onChange={(e) => setForm({ ...form, cidade: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>UF *</Label>
            <Input
              required
              maxLength={2}
              value={form.uf}
              onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Ponto de referência</Label>
          <Input
            value={form.pontoReferencia}
            onChange={(e) => setForm({ ...form, pontoReferencia: e.target.value })}
            placeholder='ex: "portaria fundos", "balança 2"'
          />
        </div>

        <div className="space-y-2">
          <Label>Apelidos do motorista</Label>
          <TagInput
            value={form.apelidos}
            onChange={(arr) => setForm({ ...form, apelidos: arr })}
            placeholder='ex: "pedreira nova", "do souza"'
          />
          <p className="text-xs text-muted-foreground">
            Como o motorista chama no WhatsApp/áudio. O agente IA usa pra
            achar o local quando ele escreve diferente do cadastro.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select
              value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value as Tipo })}
            >
              <option value="AMBOS">Carga e descarga</option>
              <option value="CARGA">Apenas carga</option>
              <option value="DESCARGA">Apenas descarga</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Clientes (opcional)</Label>
            <ClienteComboboxMulti
              value={form.clienteIds}
              onChange={(ids) => setForm({ ...form, clienteIds: ids })}
              initialOptions={(initial?.clientes ?? []).map((c) => ({
                value: c.id,
                label: c.nome,
              }))}
              placeholder="Sem cliente vinculado"
            />
            <p className="text-xs text-muted-foreground">
              Sem cliente vinculado = local genérico, aparece pra qualquer viagem.
            </p>
          </div>
        </div>

        </Card>

        {temCoord && (
          <Card className="space-y-3 p-6">
            <Label>Localização no mapa</Label>
            {/* Foto do ponto: conferência imediata de "o pin caiu no portão
                certo?" logo depois de escolher o endereço no autocomplete. */}
            <FotoLocal lat={form.lat!} lng={form.lng!} className="h-[200px]" />
            <PontoMap lat={form.lat!} lng={form.lng!} label={form.nome || undefined} />
            <p className="text-xs text-muted-foreground">
              Coordenadas: {form.lat!.toFixed(6)}, {form.lng!.toFixed(6)}.
              Pra atualizar, busque o endereço de novo no autocomplete.
            </p>
          </Card>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Link href="/locais">
          <Button type="button" variant="outline">
            Cancelar
          </Button>
        </Link>
        <Button type="submit" disabled={saving}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
