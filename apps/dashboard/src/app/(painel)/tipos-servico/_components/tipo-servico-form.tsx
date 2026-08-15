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

export type TipoServico = {
  id: string;
  slug: string;
  nome: string;
  ativo: boolean;
  padrao: boolean;
  ordem: number;
  medicao: "PESO" | "PERIODO";
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
};

const PATH = "/admin/tipos-servico";

type Props = { initial?: TipoServico };

type TipoServicoBody = {
  nome: string;
  medicao: "PESO" | "PERIODO";
  exigeMaterial: boolean;
  exigeTicket: boolean;
  exigeLocalDescarga: boolean;
  exigeKm: boolean;
  ordem: number;
};

export function TipoServicoForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<TipoServicoBody, TipoServico>(PATH, PATH);
  const update = useUpdateResource<Partial<TipoServicoBody>, TipoServico>(PATH, PATH);
  const [form, setForm] = useState<TipoServicoBody>({
    nome: initial?.nome ?? "",
    medicao: initial?.medicao ?? "PESO",
    exigeMaterial: initial?.exigeMaterial ?? true,
    exigeTicket: initial?.exigeTicket ?? true,
    exigeLocalDescarga: initial?.exigeLocalDescarga ?? true,
    exigeKm: initial?.exigeKm ?? true,
    ordem: initial?.ordem ?? 0,
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (initial) {
      // `medicao` não é editável depois de criado: virar a medição de um modo
      // que já tem viagens lançadas reinterpretaria o histórico inteiro.
      const { medicao: _medicao, ...editaveis } = form;
      await update.mutateAsync({ id: initial.id, body: editaveis });
    } else {
      await create.mutateAsync(form);
    }
    router.push("/tipos-servico");
  }

  const saving = create.isPending || update.isPending;
  const ehPeriodo = form.medicao === "PERIODO";

  /** Escolher "por período" no cadastro já sugere o desenho de uma diária. */
  function escolherMedicao(medicao: "PESO" | "PERIODO") {
    setForm((f) =>
      medicao === "PERIODO"
        ? { ...f, medicao, exigeMaterial: false, exigeTicket: false }
        : { ...f, medicao, exigeMaterial: true, exigeTicket: true },
    );
  }

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
            placeholder="ex: Diária"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            É o que o motorista lê no app na hora de escolher o tipo de serviço.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border p-3">
          <Label>Como é medido</Label>
          {initial ? (
            <p className="text-sm">
              {ehPeriodo ? "Por período (entrada e saída)" : "Por peso (toneladas)"}
              <span className="ml-2 text-xs text-muted-foreground">
                não dá pra mudar depois de criado
              </span>
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => escolherMedicao("PESO")}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  !ehPeriodo ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <div className="text-sm font-medium">Por peso</div>
                <div className="text-xs text-muted-foreground">
                  O motorista informa as toneladas. É o frete de sempre.
                </div>
              </button>
              <button
                type="button"
                onClick={() => escolherMedicao("PERIODO")}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  ehPeriodo ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                }`}
              >
                <div className="text-sm font-medium">Por período</div>
                <div className="text-xs text-muted-foreground">
                  O motorista marca a hora que entrou e a que saiu. É a diária.
                </div>
              </button>
            </div>
          )}
          {ehPeriodo && (
            <p className="text-xs text-muted-foreground">
              Serviço por período não tem peso: o app troca o campo de toneladas por
              entrada e saída, e essa viagem não entra na soma de toneladas nem nas
              regras de mínimo.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <Label>O que esse serviço pede</Label>
          <LinhaFlag
            titulo="Material"
            hint="Desligue pra diária de caminhão à disposição, que não carrega um material específico."
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
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/tipos-servico">
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
