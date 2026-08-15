"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusToggle } from "@/components/status-toggle";
import { useCreateResource, useUpdateResource } from "@/lib/client-api";

export type Modalidade = {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  exigeFotoCupom: boolean;
  exigeFotoOdometro: boolean;
  exigeFotoBomba: boolean;
};

const PATH = "/admin/modalidades";

type Body = {
  nome: string;
  exigeFotoCupom: boolean;
  exigeFotoOdometro: boolean;
  exigeFotoBomba: boolean;
  ordem: number;
};

export function ModalidadeForm({ initial }: { initial?: Modalidade }) {
  const router = useRouter();
  const create = useCreateResource<Body, Modalidade>(PATH, PATH);
  const update = useUpdateResource<Partial<Body>, Modalidade>(PATH, PATH);
  const [form, setForm] = useState<Body>({
    nome: initial?.nome ?? "",
    exigeFotoCupom: initial?.exigeFotoCupom ?? false,
    exigeFotoOdometro: initial?.exigeFotoOdometro ?? false,
    exigeFotoBomba: initial?.exigeFotoBomba ?? false,
    ordem: initial?.ordem ?? 0,
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (initial) await update.mutateAsync({ id: initial.id, body: form });
    else await create.mutateAsync(form);
    router.push("/modalidades");
  }

  const saving = create.isPending || update.isPending;

  return (
    <Card className="p-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="nome">Nome</Label>
          <Input
            id="nome"
            required
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="ex: Agregado"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            É como o vínculo aparece no cadastro do motorista. O motorista não vê nem
            escolhe a modalidade dele.
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <Label className="text-base">Fotos no abastecimento</Label>
            <p className="text-xs text-muted-foreground">
              O que o app exige de quem está nesta modalidade. Deixe tudo desligado pra
              não pedir nada — é assim que “frota própria” não tira foto nenhuma.
            </p>
          </div>
          <LinhaFlag
            titulo="Cupom do posto"
            hint="Para quem tem modalidade, este interruptor SUBSTITUI o de Minha empresa — é ele que vale."
            active={form.exigeFotoCupom}
            onChange={(v) => setForm({ ...form, exigeFotoCupom: v })}
          />
          <LinhaFlag
            titulo="Odômetro (KM)"
            hint="Comprova o quilômetro do caminhão no momento do abastecimento."
            active={form.exigeFotoOdometro}
            onChange={(v) => setForm({ ...form, exigeFotoOdometro: v })}
          />
          <LinhaFlag
            titulo="Bomba"
            hint="Foto da bomba do posto."
            active={form.exigeFotoBomba}
            onChange={(v) => setForm({ ...form, exigeFotoBomba: v })}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/modalidades">
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

function LinhaFlag({
  titulo,
  hint,
  active,
  onChange,
}: {
  titulo: string;
  hint: string;
  active: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{titulo}</span>
        <StatusToggle active={active} onChange={onChange} size="sm" />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
