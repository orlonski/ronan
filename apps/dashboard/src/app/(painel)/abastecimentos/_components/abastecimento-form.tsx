"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { VeiculoCombobox } from "@/components/fk-comboboxes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";

type Empresa = { id: string; nome: string };

export type AbastecimentoEditavel = {
  id: string;
  data: string;
  tipo: string;
  litros: string;
  valorTotal: string | null;
  emComboio: boolean;
  odometro: number;
  postoNome: string | null;
  tanqueCheio: boolean;
  observacao: string | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  empresa: { id: string; nome: string } | null;
};

const TIPO_OPCOES = [
  { value: "DIESEL_S10", label: "Diesel S10" },
  { value: "DIESEL_S500", label: "Diesel S500" },
  { value: "ARLA_32", label: "ARLA 32" },
  { value: "GASOLINA", label: "Gasolina" },
  { value: "ETANOL", label: "Etanol" },
];

type FormState = {
  data: string;
  tipo: string;
  litros: string;
  valorTotal: string;
  emComboio: boolean;
  odometro: string;
  postoNome: string;
  tanqueCheio: boolean;
  observacao: string;
  veiculoId: string;
  empresaId: string;
};

function parseDecimal(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toDateTimeInput(iso: string): string {
  // <input type="datetime-local"> usa "YYYY-MM-DDTHH:MM"
  if (!iso) return "";
  return iso.slice(0, 16);
}

export function AbastecimentoForm({ initial }: { initial: AbastecimentoEditavel }) {
  const router = useRouter();
  const token = useAuthToken();
  const qc = useQueryClient();

  const empresas = useResourceOptions<Empresa>("/admin/empresas");

  const [form, setForm] = useState<FormState>({
    data: toDateTimeInput(initial.data),
    tipo: initial.tipo,
    litros: String(initial.litros).replace(".", ","),
    valorTotal:
      initial.valorTotal != null ? String(initial.valorTotal).replace(".", ",") : "",
    emComboio: initial.emComboio,
    odometro: String(initial.odometro),
    postoNome: initial.postoNome ?? "",
    tanqueCheio: initial.tanqueCheio,
    observacao: initial.observacao ?? "",
    veiculoId: initial.veiculo.id,
    empresaId: initial.empresa?.id ?? "",
  });

  const veiculoInicial = {
    value: initial.veiculo.id,
    label: initial.veiculo.placa,
    sublabel: initial.veiculo.modelo ?? undefined,
  };

  const empresaOptions = useMemo(
    () => (empresas.data ?? []).map((e) => ({ value: e.id, label: e.nome })),
    [empresas.data],
  );

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchApi<{ id: string }>(`/admin/abastecimentos/${initial.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      toast.success("Abastecimento atualizado.");
      void qc.invalidateQueries({ queryKey: ["abastecimento-admin", initial.id] });
      void qc.invalidateQueries({ queryKey: ["abastecimento-historico", initial.id] });
      void qc.invalidateQueries({ queryKey: ["/admin/abastecimentos"] });
      router.push(`/abastecimentos/${initial.id}`);
    },
    onError: (err) => {
      toast.error("Não foi possível salvar", { description: (err as Error).message });
    },
  });

  function buildDiff(): Record<string, unknown> {
    const diff: Record<string, unknown> = {};

    if (form.data && form.data !== toDateTimeInput(initial.data)) {
      // input "YYYY-MM-DDTHH:MM" → ISO completo. Sem fuso info, browser
      // interpreta como local → backend recebe UTC ISO.
      diff.data = new Date(form.data).toISOString();
    }
    if (form.tipo !== initial.tipo) diff.tipo = form.tipo;
    if (form.veiculoId !== initial.veiculo.id) diff.veiculoId = form.veiculoId;
    if (form.empresaId !== (initial.empresa?.id ?? "")) {
      diff.empresaId = form.empresaId || null;
    }

    const litrosN = parseDecimal(form.litros);
    if (litrosN != null && litrosN !== Number(initial.litros)) diff.litros = litrosN;

    const valorN = parseDecimal(form.valorTotal);
    const valorAntigo =
      initial.valorTotal != null ? Number(initial.valorTotal) : null;
    if (valorN !== valorAntigo) {
      diff.valorTotal = valorN; // null limpa
    }

    if (form.emComboio !== initial.emComboio) diff.emComboio = form.emComboio;

    const odN = parseInt(form.odometro.replace(/\D/g, ""), 10);
    if (Number.isFinite(odN) && odN !== initial.odometro) diff.odometro = odN;

    const postoNovo = form.postoNome.trim() || null;
    const postoAntigo = initial.postoNome ?? null;
    if (postoNovo !== postoAntigo) diff.postoNome = postoNovo;

    if (form.tanqueCheio !== initial.tanqueCheio) diff.tanqueCheio = form.tanqueCheio;

    const obsNovo = form.observacao.trim() || null;
    const obsAntigo = initial.observacao ?? null;
    if (obsNovo !== obsAntigo) diff.observacao = obsNovo;

    return diff;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const body = buildDiff();
    if (Object.keys(body).length === 0) {
      toast.info("Nada pra salvar.");
      return;
    }
    await mutation.mutateAsync(body);
  }

  const saving = mutation.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Data/hora</Label>
            <Input
              type="datetime-local"
              required
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Combobox
              value={form.tipo}
              onChange={(v) => setForm({ ...form, tipo: v ?? form.tipo })}
              options={TIPO_OPCOES}
              placeholder="Selecione"
            />
          </div>
          <div className="space-y-2">
            <Label>Placa</Label>
            <VeiculoCombobox
              value={form.veiculoId}
              onChange={(v) => setForm({ ...form, veiculoId: v ?? "" })}
              initialOption={veiculoInicial}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Litros</Label>
            <Input
              required
              inputMode="decimal"
              value={form.litros}
              onChange={(e) => setForm({ ...form, litros: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Valor total (R$)</Label>
            <Input
              inputMode="decimal"
              placeholder={form.emComboio ? "Em comboio — opcional" : "0,00"}
              value={form.valorTotal}
              onChange={(e) => setForm({ ...form, valorTotal: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Odômetro</Label>
            <Input
              required
              inputMode="numeric"
              value={form.odometro}
              onChange={(e) => setForm({ ...form, odometro: e.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Posto</Label>
            <Input
              maxLength={120}
              value={form.postoNome}
              onChange={(e) => setForm({ ...form, postoNome: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Empresa pagadora</Label>
            <Combobox
              value={form.empresaId}
              onChange={(v) => setForm({ ...form, empresaId: v ?? "" })}
              options={[{ value: "", label: "— sem empresa —" }, ...empresaOptions]}
              placeholder="— sem empresa —"
            />
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.emComboio}
                onChange={(e) => setForm({ ...form, emComboio: e.target.checked })}
              />
              Em comboio (valor pendente)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.tanqueCheio}
                onChange={(e) => setForm({ ...form, tanqueCheio: e.target.checked })}
              />
              Tanque cheio
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Observação</Label>
          <Input
            maxLength={500}
            value={form.observacao}
            onChange={(e) => setForm({ ...form, observacao: e.target.value })}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href={`/abastecimentos/${initial.id}`}>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </Link>
          <Button type="submit" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
