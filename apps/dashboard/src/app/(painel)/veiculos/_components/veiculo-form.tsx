"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TransportadoraCombobox, transportadoraOption } from "@/components/fk-comboboxes";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";

export type Veiculo = {
  id: string;
  placa: string;
  modelo: string | null;
  ativo: boolean;
  transportadoraId: string | null;
  transportadora: { id: string; nome: string } | null;
};

const PATH = "/admin/veiculos";

type Props = { initial?: Veiculo };

export function VeiculoForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<Record<string, unknown>, Veiculo>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Veiculo>(PATH, PATH);

  const [form, setForm] = useState({
    placa: initial?.placa ?? "",
    modelo: initial?.modelo ?? "",
    transportadoraId: initial?.transportadoraId ?? undefined,
  });

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const body: Record<string, unknown> = {
      modelo: form.modelo || undefined,
      transportadoraId: form.transportadoraId ?? null,
    };
    if (initial) {
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync({ ...body, placa: form.placa });
    }
    router.push("/veiculos");
  }

  const saving = create.isPending || update.isPending;
  // Placa é a identidade do veículo e chave de match com o fechamento da
  // empresa — trocar depois quebraria o histórico. Só no cadastro.
  const placaTravada = !!initial;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Placa</Label>
            <Input
              required
              autoFocus={!placaTravada}
              disabled={placaTravada}
              value={form.placa}
              maxLength={8}
              onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })}
              placeholder="ABC1D23"
              className="font-mono"
            />
            {placaTravada && (
              <p className="text-xs text-muted-foreground">
                A placa não muda depois de cadastrada — é ela que casa a viagem com o
                fechamento da empresa.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Modelo</Label>
            <Input
              autoFocus={placaTravada}
              value={form.modelo}
              onChange={(e) => setForm({ ...form, modelo: e.target.value })}
              placeholder="Ex.: Scania R450"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Transportadora</Label>
          <TransportadoraCombobox
            value={form.transportadoraId}
            onChange={(v) => setForm({ ...form, transportadoraId: v })}
            triggerClassName="sm:w-full"
            initialOption={
              initial?.transportadora ? transportadoraOption(initial.transportadora) : undefined
            }
          />
          <p className="text-xs text-muted-foreground">
            Frota dona do caminhão. Vale como reserva: quem manda no dono do lançamento é a
            transportadora do motorista; esta entra quando ele não tiver uma.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Link href="/veiculos">
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
