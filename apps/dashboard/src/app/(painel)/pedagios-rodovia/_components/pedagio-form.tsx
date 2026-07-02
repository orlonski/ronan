"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";

const PontoMap = dynamic(
  () => import("@/components/ponto-map").then((m) => m.PontoMap),
  { ssr: false, loading: () => <div className="h-64 rounded-lg border bg-muted/30" /> },
);

export type PedagioRodovia = {
  id: string;
  nome: string;
  concessionaria: string | null;
  rodovia: string | null;
  cidade: string | null;
  uf: string | null;
  lat: number;
  lng: number;
  valorBase: string | null;
  ativo: boolean;
  fonte: string;
  osmId: string | null;
};

const PATH = "/admin/pedagios-rodovia";

type Props = { initial?: PedagioRodovia };

function parseNum(v: string): number | null {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function PedagioForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<Record<string, unknown>, PedagioRodovia>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, PedagioRodovia>(PATH, PATH);

  const [form, setForm] = useState({
    nome: initial?.nome ?? "",
    rodovia: initial?.rodovia ?? "",
    concessionaria: initial?.concessionaria ?? "",
    cidade: initial?.cidade ?? "",
    uf: initial?.uf ?? "",
    valorBase: initial?.valorBase ?? "",
    lat: initial?.lat != null ? String(initial.lat) : "",
    lng: initial?.lng != null ? String(initial.lng) : "",
    ativo: initial?.ativo ?? true,
  });
  const [erro, setErro] = useState<string | null>(null);

  const lat = parseNum(form.lat);
  const lng = parseNum(form.lng);
  const temCoord = lat != null && lng != null;

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    if (!form.nome.trim()) return setErro("Informe o nome do pedágio.");
    if (lat == null || lng == null) return setErro("Informe latitude e longitude válidas.");

    const body: Record<string, unknown> = {
      nome: form.nome.trim(),
      rodovia: form.rodovia.trim() || null,
      concessionaria: form.concessionaria.trim() || null,
      cidade: form.cidade.trim() || null,
      uf: form.uf.trim() ? form.uf.trim().toUpperCase() : null,
      valorBase: form.valorBase.toString().trim()
        ? parseNum(form.valorBase.toString())
        : null,
      lat,
      lng,
      ...(initial ? { ativo: form.ativo } : {}),
    };

    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync(body);
    }
    router.push("/pedagios-rodovia");
  }

  const saving = create.isPending || update.isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className={temCoord ? "grid grid-cols-1 gap-6 lg:grid-cols-2" : ""}>
        <Card className="space-y-4 p-6">
          <div className="space-y-2">
            <Label>Nome do pedágio *</Label>
            <Input
              required
              placeholder='ex: "Praça BR-376 — Ponta Grossa"'
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Rodovia</Label>
              <Input
                placeholder="ex: BR-376"
                value={form.rodovia}
                onChange={(e) => setForm({ ...form, rodovia: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Concessionária</Label>
              <Input
                placeholder="ex: CCR ViaSul"
                value={form.concessionaria}
                onChange={(e) => setForm({ ...form, concessionaria: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-2 md:col-span-2">
              <Label>Cidade</Label>
              <Input
                value={form.cidade}
                onChange={(e) => setForm({ ...form, cidade: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>UF</Label>
              <Input
                maxLength={2}
                value={form.uf}
                onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Valor base (R$/eixo)</Label>
              <Input
                inputMode="decimal"
                placeholder="opcional"
                value={form.valorBase.toString()}
                onChange={(e) => setForm({ ...form, valorBase: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Latitude *</Label>
              <Input
                required
                inputMode="decimal"
                placeholder="-25.0916"
                value={form.lat}
                onChange={(e) => setForm({ ...form, lat: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Longitude *</Label>
              <Input
                required
                inputMode="decimal"
                placeholder="-50.1668"
                value={form.lng}
                onChange={(e) => setForm({ ...form, lng: e.target.value })}
              />
            </div>
          </div>

          {initial && (
            <div className="space-y-2">
              <Label>Situação</Label>
              <Select
                value={form.ativo ? "1" : "0"}
                onChange={(e) => setForm({ ...form, ativo: e.target.value === "1" })}
              >
                <option value="1">Ativo</option>
                <option value="0">Inativo</option>
              </Select>
            </div>
          )}

          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </Card>

        {temCoord && (
          <Card className="space-y-3 p-6">
            <Label>Localização no mapa</Label>
            <PontoMap lat={lat!} lng={lng!} label={form.nome || undefined} />
            <p className="text-xs text-muted-foreground">
              Coordenadas: {lat!.toFixed(6)}, {lng!.toFixed(6)}. Ajuste nos campos de
              latitude/longitude ao lado.
            </p>
          </Card>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Link href="/pedagios-rodovia">
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
