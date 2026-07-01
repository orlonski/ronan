"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  useCreateResource,
  useResourceOptions,
  useUpdateResource,
} from "@/lib/client-api";

type Empresa = { id: string; nome: string };
type Material = { id: string; nome: string };

export type Regra = {
  id: string;
  empresaId: string;
  empresa: Empresa;
  materialId: string | null;
  material: Material | null;
  kmFaixaDe: string;
  kmFaixaAte: string | null;
  kmMinimo: string | null;
  toneladasMinimo: string | null;
  ativo: boolean;
};

const PATH = "/admin/regras-minimo";
const EMPRESAS_PATH = "/admin/empresas";
const MATERIAIS_PATH = "/admin/materiais";

type Props = { initial?: Regra };

type RegraBody = {
  empresaId: string;
  materialId: string | null;
  kmFaixaDe: number;
  kmFaixaAte: number | null;
  kmMinimo: number | null;
  toneladasMinimo: number | null;
};

// "12,5" / "12.5" → 12.5. Vazio → null. Só positivos (>0).
function parseDecimalBR(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function RegraForm({ initial }: Props) {
  const router = useRouter();
  const empresas = useResourceOptions<Empresa>(EMPRESAS_PATH);
  const materiais = useResourceOptions<Material>(MATERIAIS_PATH);
  const create = useCreateResource<RegraBody, Regra>(PATH, PATH);
  const update = useUpdateResource<Partial<RegraBody>, Regra>(PATH, PATH);
  const [erro, setErro] = useState<string | null>(null);

  const [form, setForm] = useState({
    empresaId: initial?.empresaId ?? "",
    materialId: initial?.materialId ?? "", // "" = qualquer material
    kmFaixaDe: initial?.kmFaixaDe ?? "",
    kmFaixaAte: initial?.kmFaixaAte ?? "",
    kmMinimo: initial?.kmMinimo ?? "",
    toneladasMinimo: initial?.toneladasMinimo ?? "",
  });

  // Cria: seleciona a primeira empresa por padrão.
  useEffect(() => {
    if (initial || form.empresaId || !empresas.data?.[0]?.id) return;
    setForm((f) => ({ ...f, empresaId: empresas.data![0]!.id }));
  }, [initial, form.empresaId, empresas.data]);

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);

    const kmDe = form.kmFaixaDe.trim() ? Number(form.kmFaixaDe.replace(",", ".")) : 0;
    const kmAte = parseDecimalBR(form.kmFaixaAte);
    const kmMin = parseDecimalBR(form.kmMinimo);
    const tonMin = parseDecimalBR(form.toneladasMinimo);

    if (!form.empresaId) return setErro("Escolha a empresa.");
    if (!Number.isFinite(kmDe) || kmDe < 0) return setErro("Faixa 'de' inválida.");
    if (kmAte != null && kmAte <= kmDe) return setErro("A faixa 'até' precisa ser maior que o 'de'.");
    if (kmMin == null && tonMin == null) {
      return setErro("Informe pelo menos um mínimo (km ou toneladas).");
    }

    const body: RegraBody = {
      empresaId: form.empresaId,
      materialId: form.materialId || null,
      kmFaixaDe: kmDe,
      kmFaixaAte: kmAte,
      kmMinimo: kmMin,
      toneladasMinimo: tonMin,
    };

    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, body });
      } else {
        await create.mutateAsync(body);
      }
      router.push("/regras-minimo");
    } catch (e) {
      setErro((e as Error).message ?? "Erro ao salvar.");
    }
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select
              required
              value={form.empresaId}
              onChange={(e) => setForm({ ...form, empresaId: e.target.value })}
            >
              <option value="" disabled>
                Escolha a empresa
              </option>
              {empresas.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Material</Label>
            <Select
              value={form.materialId}
              onChange={(e) => setForm({ ...form, materialId: e.target.value })}
            >
              <option value="">Qualquer material</option>
              {materiais.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label>Faixa de km rodado</Label>
          <div className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              placeholder="de (ex: 0)"
              value={form.kmFaixaDe}
              onChange={(e) => setForm({ ...form, kmFaixaDe: e.target.value })}
              className="w-32"
            />
            <span className="text-sm text-muted-foreground">até</span>
            <Input
              inputMode="decimal"
              placeholder="sem teto"
              value={form.kmFaixaAte}
              onChange={(e) => setForm({ ...form, kmFaixaAte: e.target.value })}
              className="w-32"
            />
            <span className="text-sm text-muted-foreground">km</span>
          </div>
          <p className="text-xs text-muted-foreground">
            &quot;de&quot; incluído, &quot;até&quot; excluído. Deixe o &quot;até&quot; vazio pra
            sem teto. Ex.: 0 até 10; 10 até 15.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Km mínimo faturado</Label>
            <Input
              inputMode="decimal"
              placeholder="ex: 10"
              value={form.kmMinimo}
              onChange={(e) => setForm({ ...form, kmMinimo: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Toneladas mínimas</Label>
            <Input
              inputMode="decimal"
              placeholder="opcional"
              value={form.toneladasMinimo}
              onChange={(e) => setForm({ ...form, toneladasMinimo: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Informe pelo menos um dos dois. Quando a viagem casa (empresa + material + km na
          faixa), esse mínimo vence o mínimo do cliente.
        </p>

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/regras-minimo">
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </Link>
          <Button type="submit" disabled={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
