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
import { useSujo } from "@/hooks/use-sujo";
import { BotaoCancelar, useAvisarSeSujo } from "@/components/sair-sem-salvar";

export type TipoServico = {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  padrao: boolean;
  ordem: number;
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
  /** Ausente em API anterior à coluna — vale true (mostra). */
  mostraPedagio?: boolean;
};

const PATH = "/admin/tipos-servico";

type Props = { initial?: TipoServico };

type TipoServicoBody = {
  nome: string;
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
  mostraPedagio: boolean;
  ordem: number;
};

export function TipoServicoForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<TipoServicoBody, TipoServico>(PATH, PATH);
  const update = useUpdateResource<Partial<TipoServicoBody>, TipoServico>(PATH, PATH);
  const [form, setForm] = useState<TipoServicoBody>({
    nome: initial?.nome ?? "",
    exigeMaterial: initial?.exigeMaterial ?? true,
    exigeTicket: initial?.exigeTicket ?? true,
    exigeLocalDescarga: initial?.exigeLocalDescarga ?? true,
    exigeKm: initial?.exigeKm ?? true,
    mostraPedagio: initial?.mostraPedagio ?? true,
    ordem: initial?.ordem ?? 0,
  });

  // Sair de um cadastro longo descartava tudo em silêncio.
  const sujo = useSujo(form);
  useAvisarSeSujo(sujo);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (initial) {
      await update.mutateAsync({ id: initial.id, body: form });
    } else {
      await create.mutateAsync(form);
    }
    router.push("/tipos-servico");
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
            placeholder="ex: Frete por tonelada"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            É o que o motorista lê no app na hora de escolher o tipo de viagem.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ordem">Ordem</Label>
          <Input
            id="ordem"
            type="number"
            min={0}
            max={999}
            className="w-32"
            value={form.ordem}
            onChange={(e) =>
              setForm({ ...form, ordem: Math.max(0, Math.min(999, Number(e.target.value) || 0)) })
            }
          />
          <p className="text-xs text-muted-foreground">
            Posição na lista que o motorista vê no app (menor primeiro).
          </p>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <Label>O que o app pede nesse tipo de viagem</Label>
          <LinhaFlag
            titulo="Material"
            hint="Desligue pro serviço que não carrega um material específico."
            active={form.exigeMaterial}
            onChange={(next) => setForm({ ...form, exigeMaterial: next })}
          />
          <LinhaFlag
            titulo="Ticket"
            hint="Vale junto com o cadastro do material: basta um dos dois dispensar pro campo sumir."
            active={form.exigeTicket}
            onChange={(next) => setForm({ ...form, exigeTicket: next })}
          />
          <LinhaFlag
            titulo="Local de descarga"
            hint="Desligue quando o serviço começa e termina no mesmo lugar."
            active={form.exigeLocalDescarga}
            onChange={(next) => setForm({ ...form, exigeLocalDescarga: next })}
          />
          <LinhaFlag
            titulo="Km rodado"
            hint="Desligue pra serviço em que o caminhão fica à disposição e o km não é o que se cobra."
            active={form.exigeKm}
            onChange={(next) => setForm({ ...form, exigeKm: next })}
          />
          <LinhaFlag
            titulo="Mostrar o pedágio"
            hint="Desligado, o app esconde o campo de pedágio e não avisa quando a rota passa por um."
            active={form.mostraPedagio}
            onChange={(next) => setForm({ ...form, mostraPedagio: next })}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <BotaoCancelar href="/tipos-servico" sujo={sujo} />
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
