"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import {
  ClienteCombobox,
  LocalCombobox,
  VeiculoCombobox,
} from "@/components/fk-comboboxes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchApi, useAuthToken, useResourceOptions } from "@/lib/client-api";

type Material = { id: string; nome: string };
type Motorista = { id: string; nome: string };

export type ViagemEditavel = {
  id: string;
  // Null quando a viagem está AGUARDANDO_PESO (lançada sem o peso). Admin
  // preenche aqui e o backend transiciona pra ENVIADA.
  toneladas: string | null;
  data: string;
  ticket: string | null;
  km: string;
  kmCalculado: string | null;
  observacao: string | null;
  valorPedagioTotal: string | null;
  status: string;
  // Coordenadas capturadas pelo motorista no momento do lançamento (opcional —
  // null se ele negou GPS). Usado pra sugerir local de descarga próximo.
  lat: number | null;
  lng: number | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  motorista: Motorista;
  // Ausentes pra quem não tem `viagens.ver-comercial` — o backend omite.
  cliente?: { id: string; nome: string } | null;
  material: { id: string; nome: string };
  localCarga: { id: string; nome: string; cidade: string; uf: string };
  localDescarga: { id: string; nome: string; cidade: string; uf: string };
  matchesFechamento?: { id: string }[];
};

type FormState = {
  data: string;
  ticket: string;
  toneladas: string;
  km: string;
  valorPedagioTotal: string;
  observacao: string;
  veiculoId: string;
  clienteId: string;
  materialId: string;
  localCargaId: string;
  localDescargaId: string;
};

function parseDecimal(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Converte ISO/Date pra "YYYY-MM-DD" pra input type="date"
function toDateInput(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function ViagemForm({ initial }: { initial: ViagemEditavel }) {
  const router = useRouter();
  const token = useAuthToken();
  const qc = useQueryClient();

  // Veículo, cliente e local usam autocomplete server-side (sem teto de 200).
  // Material é catálogo pequeno — segue carregando tudo.
  const materiais = useResourceOptions<Material>("/admin/materiais");

  const [form, setForm] = useState<FormState>({
    data: toDateInput(initial.data),
    ticket: initial.ticket ?? "",
    toneladas:
      initial.toneladas != null
        ? String(initial.toneladas).replace(".", ",")
        : "",
    km: String(initial.km).replace(".", ","),
    valorPedagioTotal:
      initial.valorPedagioTotal != null
        ? String(initial.valorPedagioTotal).replace(".", ",")
        : "",
    observacao: initial.observacao ?? "",
    veiculoId: initial.veiculo.id,
    clienteId: initial.cliente?.id ?? "",
    materialId: initial.material.id,
    localCargaId: initial.localCarga.id,
    localDescargaId: initial.localDescarga.id,
  });

  const materialOptions = useMemo(
    () => (materiais.data ?? []).map((m) => ({ value: m.id, label: m.nome })),
    [materiais.data],
  );

  // Opções iniciais (o que já está selecionado) pra o autocomplete mostrar o
  // nome no trigger antes de qualquer busca.
  const veiculoInicial = {
    value: initial.veiculo.id,
    label: initial.veiculo.placa,
    sublabel: initial.veiculo.modelo ?? undefined,
  };
  const clienteInicial = initial.cliente
    ? { value: initial.cliente.id, label: initial.cliente.nome }
    : undefined;
  const localCargaInicial = {
    value: initial.localCarga.id,
    label: initial.localCarga.nome,
    sublabel: `${initial.localCarga.cidade}/${initial.localCarga.uf}`,
  };
  const localDescargaInicial = {
    value: initial.localDescarga.id,
    label: initial.localDescarga.nome,
    sublabel: `${initial.localDescarga.cidade}/${initial.localDescarga.uf}`,
  };

  // Sugere o local mais próximo do lat/lng capturado pelo motorista no
  // lançamento (raio 500m). Útil pra corrigir viagens onde motorista
  // selecionou local errado mas o GPS estava certo. Server-side agora (antes
  // varria a lista completa carregada, que sumiu com o autocomplete).
  const temGps = initial.lat != null && initial.lng != null;
  const sugestao = useQuery({
    queryKey: ["local-proximo", initial.id, form.localDescargaId],
    enabled: !!token && temGps,
    queryFn: () =>
      fetchApi<{ id: string; nome: string; cidade: string; uf: string; dist: number } | null>(
        `/admin/locais/proximo?lat=${initial.lat}&lng=${initial.lng}&raioM=500&excluirId=${form.localDescargaId}`,
        { token },
      ),
  });
  const sugestaoDescarga = sugestao.data ?? null;

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchApi<{ id: string }>(`/admin/viagens/${initial.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        token,
      }),
    onSuccess: () => {
      toast.success("Viagem atualizada.");
      void qc.invalidateQueries({ queryKey: ["viagem-admin", initial.id] });
      void qc.invalidateQueries({ queryKey: ["viagem-historico", initial.id] });
      void qc.invalidateQueries({ queryKey: ["/admin/viagens"] });
      router.push(`/viagens/${initial.id}`);
    },
    onError: (err) => {
      toast.error("Não foi possível salvar", {
        description: (err as Error).message,
      });
    },
  });

  function buildDiff(): Record<string, unknown> {
    const diff: Record<string, unknown> = {};

    if (form.data && form.data !== toDateInput(initial.data)) {
      diff.data = new Date(form.data + "T00:00:00.000Z").toISOString();
    }
    // Ticket vazio vira null (material que não exige ticket).
    const ticketNorm = form.ticket.trim() || null;
    if (ticketNorm !== (initial.ticket ?? null)) diff.ticket = ticketNorm;
    if (form.veiculoId !== initial.veiculo.id) diff.veiculoId = form.veiculoId;
    if (form.clienteId !== (initial.cliente?.id ?? "")) diff.clienteId = form.clienteId;
    if (form.materialId !== initial.material.id) diff.materialId = form.materialId;
    if (form.localCargaId !== initial.localCarga.id)
      diff.localCargaId = form.localCargaId;
    if (form.localDescargaId !== initial.localDescarga.id)
      diff.localDescargaId = form.localDescargaId;

    const tonNum = parseDecimal(form.toneladas);
    if (tonNum != null && tonNum !== Number(initial.toneladas)) {
      diff.toneladas = tonNum;
    }
    const kmNum = parseDecimal(form.km);
    if (kmNum != null && kmNum !== Number(initial.km)) {
      diff.km = kmNum;
    }

    const pedagioNovo = parseDecimal(form.valorPedagioTotal);
    const pedagioAntigo =
      initial.valorPedagioTotal != null ? Number(initial.valorPedagioTotal) : null;
    if (pedagioNovo !== pedagioAntigo) {
      diff.valorPedagioTotal = pedagioNovo;
    }

    const obsNovo = form.observacao.trim() === "" ? null : form.observacao;
    const obsAntigo = initial.observacao;
    if (obsNovo !== obsAntigo) {
      diff.observacao = obsNovo;
    }

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
        {initial.status === "AGUARDANDO_PESO" && (
          <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
            <strong>Aguardando peso.</strong> Essa viagem foi lançada sem o peso
            (romaneio no fim do dia) e não entra em fechamento. Preencha as
            toneladas (e o ticket) e salve — ela passa pra “Aguardando
            conferência” automaticamente.
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Data</Label>
            <Input
              type="date"
              required
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Ticket</Label>
            <Input
              value={form.ticket}
              onChange={(e) => setForm({ ...form, ticket: e.target.value })}
              maxLength={50}
              placeholder="deixe vazio se o material não exige"
            />
          </div>
          <div className="space-y-2">
            <Label>Placa do veículo</Label>
            <VeiculoCombobox
              value={form.veiculoId}
              onChange={(v) => setForm({ ...form, veiculoId: v ?? "" })}
              initialOption={veiculoInicial}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <ClienteCombobox
              value={form.clienteId}
              onChange={(v) => setForm({ ...form, clienteId: v ?? "" })}
              initialOption={clienteInicial}
            />
          </div>
          <div className="space-y-2">
            <Label>Material</Label>
            <Combobox
              value={form.materialId}
              onChange={(v) => setForm({ ...form, materialId: v ?? "" })}
              options={materialOptions}
              placeholder="Selecione"
            />
          </div>
          <div className="space-y-2">
            <Label>Toneladas</Label>
            <Input
              required
              inputMode="decimal"
              value={form.toneladas}
              onChange={(e) => setForm({ ...form, toneladas: e.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Local de carga</Label>
            <LocalCombobox
              value={form.localCargaId}
              onChange={(v) => setForm({ ...form, localCargaId: v ?? "" })}
              initialOption={localCargaInicial}
            />
          </div>
          <div className="space-y-2">
            <Label>Local de descarga</Label>
            {sugestaoDescarga && (
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({ ...f, localDescargaId: sugestaoDescarga.id }))
                }
                className="w-full rounded border border-blue-300 bg-blue-50 px-3 py-2 text-left text-xs text-blue-900 hover:bg-blue-100"
                title="Usa o lat/lng que o motorista capturou no lançamento"
              >
                📍 Usar lugar do lançamento:{" "}
                <strong>{sugestaoDescarga.nome}</strong> (
                {Math.round(sugestaoDescarga.dist)}m)
              </button>
            )}
            <LocalCombobox
              value={form.localDescargaId}
              onChange={(v) => setForm({ ...form, localDescargaId: v ?? "" })}
              initialOption={localDescargaInicial}
            />
          </div>
          <div className="space-y-2">
            <Label>Km</Label>
            <Input
              required
              inputMode="decimal"
              value={form.km}
              onChange={(e) => setForm({ ...form, km: e.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Valor pedágio (R$)</Label>
            <Input
              inputMode="decimal"
              placeholder="Vazio = sem pedágio"
              value={form.valorPedagioTotal}
              onChange={(e) =>
                setForm({ ...form, valorPedagioTotal: e.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Observação</Label>
            <Input
              maxLength={500}
              value={form.observacao}
              onChange={(e) => setForm({ ...form, observacao: e.target.value })}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href={`/viagens/${initial.id}`}>
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
